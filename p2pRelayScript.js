var params = new URLSearchParams(location.search);
var action = params.get("action");
var room = params.get("room");
var returnTo = params.get("returnTo");
var fullAmount = parseInt(params.get("fullAmount") || "2", 10);

var joined = 0;
var joinComplete = false;
var popupMode = !returnTo;
var peerConnection = null;
var outboundQueue = [];

function setStatus(msg) { document.getElementById("status").innerHTML = msg; }
function setLobby(msg) { document.getElementById("lobby").textContent = msg; }

function notifyClient(extraParams) {
    extraParams = extraParams || {};
    if (popupMode && window.opener) {
        window.opener.postMessage(Object.assign({ type: "relay_event", room: room }, extraParams), "*");
        return;
    }
    bounce(extraParams);
}

function notifySignal(payload) {
    if (popupMode && window.opener) {
        window.opener.postMessage({ type: "signal_data", room: room, payload: payload }, "*");
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

if (!action || !room || (!returnTo && !popupMode)) {
    setStatus("Missing params.");
} else if (action === "create") {
    if (popupMode) {
        runSignalCreate();
    } else {
        runCreate();
    }
} else if (action === "join") {
    if (popupMode) {
        runSignalJoin();
    } else {
        runJoin();
    }
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
    notifyClient({ peerEvent: "connected_as_joiner", role: role });
}

function forwardSignal(payload) {
    if (peerConnection && peerConnection.open) {
        peerConnection.send(payload);
    } else {
        outboundQueue.push(payload);
    }
}

function flushSignalQueue() {
    while (peerConnection && peerConnection.open && outboundQueue.length) {
        peerConnection.send(outboundQueue.shift());
    }
}

window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || msg.room !== room) return;
    if (msg.type === "signal_send") {
        forwardSignal(msg.payload);
    }
});

function runCreate() {
    joined = 1;
    updateLobby(joined);
    setStatus('<span class="spinner">↻</span>');

    var peer = new Peer(room);
    var connections = [];

    peer.on("error", function (err) {
        notifyClient({ peerEvent: "error", detail: err.message });
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
                        if (popupMode) {
                            notifyClient({ peerEvent: "room_full", role: "host" });
                        } else {
                            setTimeout(function () {
                                peer.destroy();
                                bounce({ peerEvent: "room_full", role: "host" });
                            }, 600);
                        }
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
        notifyClient({ peerEvent: "error", detail: err.message });
    });

    peer.on("open", function () {
        var conn = peer.connect(room);

        var timer = setTimeout(function () {
            peer.destroy();
            notifyClient({ peerEvent: "error", detail: "connection_timeout" });
        }, 10000);

        conn.on("error", function (err) {
            clearTimeout(timer);
            peer.destroy();
            notifyClient({ peerEvent: "error", detail: err.message });
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

function runSignalCreate() {
    var peer = new Peer(room);
    setStatus('<span class="spinner">↻</span>');
    setLobby("Relay: " + room + "\nWaiting for joiner...");

    peer.on("error", function (err) {
        notifyClient({ peerEvent: "error", detail: err.message });
    });

    peer.on("open", function () {
        notifyClient({ peerEvent: "room_created", role: "host" });

        peer.on("connection", function (conn) {
            peerConnection = conn;

            conn.on("open", function () {
                notifyClient({ peerEvent: "connected_as_host", role: "host" });
                flushSignalQueue();
            });

            conn.on("data", function (data) {
                notifySignal(data);
            });

            conn.on("error", function (err) {
                notifyClient({ peerEvent: "error", detail: err.message });
            });
        });
    });
}

function runSignalJoin() {
    var peer = new Peer();
    setStatus('<span class="spinner">↻</span>');
    setLobby("Relay: " + room + "\nConnecting...");

    peer.on("error", function (err) {
        notifyClient({ peerEvent: "error", detail: err.message });
    });

    peer.on("open", function () {
        var conn = peer.connect(room);
        peerConnection = conn;

        conn.on("open", function () {
            notifyClient({ peerEvent: "connected_as_joiner", role: "joiner" });
            flushSignalQueue();
        });

        conn.on("data", function (data) {
            notifySignal(data);
        });

        conn.on("error", function (err) {
            notifyClient({ peerEvent: "error", detail: err.message });
        });
    });
}