var params = new URLSearchParams(location.search);
var action = params.get("action");
var room = params.get("room");
var returnTo = params.get("returnTo");
var fullAmount = parseInt(params.get("fullAmount") || "2", 10);

var joined = 0;

function setStatus(msg) { document.getElementById("status").innerHTML = msg; }
function setLobby(msg) { document.getElementById("lobby").textContent = msg; }

function bounce(extraParams) {
    extraParams = extraParams || {};
    if (!returnTo) return;
    var dest = new URL(returnTo);
    dest.searchParams.set("room", room);
    for (var k in extraParams) dest.searchParams.set(k, extraParams[k]);
    setTimeout(function () { location.href = dest.toString(); }, 400);
}

if (!action || !room || !returnTo) {
    setStatus("Missing params.");
} else if (action === "create") {
    runCreate();
} else if (action === "join") {
    runJoin();
} else {
    bounce({ peerEvent: "error", detail: "unknown_action" });
}

function updateLobby(connectedCount) {
    var waiting = fullAmount - connectedCount;
    setLobby("Lobby: " + room + "\nWaiting for " + waiting + "/" + fullAmount + " more people to join.");
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
                setStatus("");
                peer.destroy();
                bounce({ peerEvent: "connected_as_joiner", role: "joiner" });
            } else if (typeof data === "number") {
                var waiting = fullAmount - data;
                setLobby("Lobby: " + room + "\nWaiting for " + waiting + "/" + fullAmount + " more people to join.");
            }
        });
    });
}