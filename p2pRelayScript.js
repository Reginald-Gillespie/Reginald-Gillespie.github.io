var params = new URLSearchParams(location.search);
var action = params.get("action");
var room = params.get("room");
var returnTo = params.get("returnTo");
var fullAmount = parseInt(params.get("fullAmount") || "2", 10);
var role = params.get("role");

var joined = 0;
var joinComplete = false;
var bridgeConn = null;
var bridgeQueue = [];

function setStatus(msg) { document.getElementById("status").innerHTML = msg; }
function setLobby(msg) { document.getElementById("lobby").textContent = msg; }

function postToParent(payload) {
    if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, "*");
    }
}

function bounce(extraParams) {
    extraParams = extraParams || {};
    if (!returnTo) return;
    var dest = new URL(returnTo);
    dest.searchParams.set("room", room);
    for (var k in extraParams) dest.searchParams.set(k, extraParams[k]);
    setTimeout(function () { location.href = dest.toString(); }, 400);
}

if (!action || !room || (action !== "bridge" && !returnTo)) {
    setStatus("Missing params.");
} else if (action === "create") {
    runCreate();
} else if (action === "join") {
    runJoin();
} else if (action === "bridge") {
    runBridge();
} else {
    bounce({ peerEvent: "error", detail: "unknown_action" });
}

function updateLobby(connectedCount) {
    var waiting = Math.max(0, fullAmount - connectedCount);
    setLobby("Lobby: " + room + "\nWaiting for " + waiting + "/" + fullAmount + " more people to join.");
}

function finalizeJoin(peer, role) {
    if (joinComplete) return;
    joinComplete = true;
    setStatus("");
    peer.destroy();
    bounce({ peerEvent: "connected_as_joiner", role: role });
}

function queueOrSend(data) {
    if (bridgeConn && bridgeConn.open) {
        bridgeConn.send(data);
        return;
    }
    bridgeQueue.push(data);
}

function flushQueue() {
    if (!bridgeConn || !bridgeConn.open) return;
    while (bridgeQueue.length) {
        bridgeConn.send(bridgeQueue.shift());
    }
}

function attachBridgeConn(conn, roleName) {
    bridgeConn = conn;

    bridgeConn.on("error", function (err) {
        postToParent({ type: "relay_bridge_error", room: room, detail: err.message });
    });

    bridgeConn.on("open", function () {
        setStatus("");
        setLobby("Lobby: " + room + "\nGame transport connected.");
        flushQueue();
        postToParent({ type: "relay_bridge_ready", room: room, role: roleName });
    });

    bridgeConn.on("data", function (data) {
        postToParent({ type: "relay_bridge_data", room: room, data: data });
    });
}

function runBridge() {
    if (role !== "host" && role !== "joiner") {
        setStatus("Missing role for bridge.");
        postToParent({ type: "relay_bridge_error", room: room, detail: "missing_role" });
        return;
    }

    setStatus('<span class="spinner">↻</span>');
    setLobby("Lobby: " + room + "\nStarting game transport...");

    var peer;

    window.addEventListener("message", function (event) {
        var msg = event.data;
        if (!msg || msg.type !== "relay_send" || msg.room !== room) return;
        queueOrSend(msg.data);
    });

    if (role === "host") {
        peer = new Peer(room + "_game");

        peer.on("error", function (err) {
            postToParent({ type: "relay_bridge_error", room: room, detail: err.message });
        });

        peer.on("open", function () {
            setLobby("Lobby: " + room + "\nWaiting for game peer...");
            peer.on("connection", function (conn) {
                attachBridgeConn(conn, "host");
            });
        });
    } else {
        peer = new Peer();

        peer.on("error", function (err) {
            postToParent({ type: "relay_bridge_error", room: room, detail: err.message });
        });

        peer.on("open", function () {
            var conn = peer.connect(room + "_game");
            attachBridgeConn(conn, "joiner");
        });
    }
}

function runCreate() {
    joined = 1;
    updateLobby(joined);
    setStatus('<span class="spinner">↻</span>');

    var peer = new Peer(room);
    var connections = [];

    peer.on("error", function (err) {
        bounce({ peerEvent: "error", detail: err.message });
    });

    peer.on("open", function () {
        updateLobby(joined);

        peer.on("connection", function (conn) {
            conn.on("open", function () {
                connections.push(conn);
                joined++;
                updateLobby(joined);

                setTimeout(function () {
                    connections.forEach(function (c) { c.send(joined); });

                    if (joined >= fullAmount) {
                        setStatus("");
                        connections.forEach(function (c) { c.send("__full__"); });
                        setTimeout(function () {
                            peer.destroy();
                            bounce({ peerEvent: "room_full", role: "host" });
                        }, 600);
                    }
                }, 100);
            });
        });
    });
}

function runJoin() {
    setStatus('<span class="spinner">↻</span>');
    setLobby("Lobby: " + room + "\nConnecting...");

    var peer = new Peer();

    peer.on("error", function (err) {
        bounce({ peerEvent: "error", detail: err.message });
    });

    peer.on("open", function () {
        var conn = peer.connect(room);

        var timer = setTimeout(function () {
            peer.destroy();
            bounce({ peerEvent: "error", detail: "connection_timeout" });
        }, 10000);

        conn.on("error", function (err) {
            clearTimeout(timer);
            peer.destroy();
            bounce({ peerEvent: "error", detail: err.message });
        });

        conn.on("open", function () {
            clearTimeout(timer);
            conn.send("__joined__");
            setLobby("Lobby: " + room + "\nWaiting for others to join...");
        });

        conn.on("data", function (data) {
            if (data === "__full__") {
                finalizeJoin(peer, "joiner");
            } else if (typeof data === "number") {
                if (data >= fullAmount) {
                    finalizeJoin(peer, "joiner");
                    return;
                }

                var waiting = Math.max(0, fullAmount - data);
                setLobby("Lobby: " + room + "\nWaiting for " + waiting + "/" + fullAmount + " more people to join.");
            }
        });
    });
}