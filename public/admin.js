(function () {
	var origin = window.location.origin.replace(/\/$/, '');
	var socket = io(origin + '/admin');
	var params = new URLSearchParams(window.location.search);
	var adminIdParam = params.get('adminId');
	var adminUserId = adminIdParam || localStorage.getItem('cg_userId') || null;
	var connectedUsersEl = document.getElementById('connectedUsers');
	var quickplayQueueEl = document.getElementById('quickplayQueue');
        var rankedQueueEl = document.getElementById('rankedQueue');
        var quickplayQueueListEl = document.getElementById('quickplayQueueList');
        var rankedQueueListEl = document.getElementById('rankedQueueList');
        var usersListEl = document.getElementById('usersList');
        var gamesListEl = document.getElementById('gamesList');
        var matchesListEl = document.getElementById('matchesList');
        var purgeBtn = document.getElementById('purgeGamesBtn');
        var purgeMatchesBtn = document.getElementById('purgeMatchesBtn');
        var purgeUsersBtn = document.getElementById('purgeUsersBtn');
        var usernameMap = {};
        var latestMetrics = null;

        function renderList(targetEl, ids) {
                if (!targetEl) return;
                targetEl.innerHTML = '';
                if (!Array.isArray(ids) || ids.length === 0) return;
                var frag = document.createDocumentFragment();
                ids.forEach(function (id) {
                        var row = document.createElement('div');
                        row.className = 'row';
                        var nameEl = document.createElement(adminUserId && id === adminUserId ? 'strong' : 'span');
                        nameEl.textContent = usernameMap[id] || 'Unknown';
                        nameEl.title = id;
                        row.appendChild(nameEl);
                        frag.appendChild(row);
                });
                targetEl.appendChild(frag);
        }

        function renderUsersList(targetEl, users, connectedIds) {
                if (!targetEl) return;
                targetEl.innerHTML = '';
                if (!Array.isArray(users) || users.length === 0) return;
                var connectedSet = new Set(connectedIds || []);
                users.sort(function (a, b) {
                        return (connectedSet.has(b.id) - connectedSet.has(a.id)) || (a.username || '').localeCompare(b.username || '');
                });
                var frag = document.createDocumentFragment();
                var header = document.createElement('div');
                header.className = 'row headerRow';
                var hName = document.createElement('span');
                hName.textContent = 'Username';
                var hConn = document.createElement('span');
                hConn.textContent = 'Connected';
                header.appendChild(hName);
                header.appendChild(hConn);
                frag.appendChild(header);
                users.forEach(function (u) {
                        var row = document.createElement('div');
                        row.className = 'row';
                        row.style.justifyContent = 'space-between';
                        row.style.gap = '0';
                        var nameEl = document.createElement(adminUserId && u.id === adminUserId ? 'strong' : 'span');
                        nameEl.textContent = u.username || 'Unknown';
                        nameEl.title = u.id;
                        var connEl = document.createElement('span');
                        if (connectedSet.has(u.id)) {
                                var img = document.createElement('img');
                                img.src = 'assets/images/GoldThrone.svg';
                                img.alt = '';
                                img.style.width = '16px';
                                img.style.height = '16px';
                                connEl.appendChild(img);
                        }
                        row.appendChild(nameEl);
                        row.appendChild(connEl);
                        frag.appendChild(row);
                });
                targetEl.appendChild(frag);
        }

        async function fetchAllUsers() {
                if (!usersListEl) return;
                try {
                        var res = await fetch('/api/v1/users/getList', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({})
                        });
                        if (!res.ok) {
                                console.error('Failed to fetch user accounts:', res.status);
                                return;
                        }
                        var data = await res.json();
                        var users = [];
                        if (Array.isArray(data)) {
                                data.forEach(function (u) {
                                        var id = u._id ? u._id.toString() : '';
                                        if (!id) return;
                                        var username = u.username || 'Unknown';
                                        usernameMap[id] = username;
                                        users.push({ id: id, username: username });
                                });
                        }
                        renderUsersList(usersListEl, users, latestMetrics ? latestMetrics.connectedUserIds : []);
                        if (latestMetrics) {
                                renderList(quickplayQueueListEl, latestMetrics.quickplayQueueUserIds);
                                renderList(rankedQueueListEl, latestMetrics.rankedQueueUserIds);
                                renderGameOrMatchList(gamesListEl, latestMetrics.games);
                                renderGameOrMatchList(matchesListEl, latestMetrics.matches);
                        }
                } catch (err) {
                        console.error('Error fetching user accounts:', err);
                }
        }

        function renderGameOrMatchList(targetEl, items) {
                if (!targetEl) return;
                targetEl.innerHTML = '';
                if (!Array.isArray(items) || items.length === 0) return;
                var frag = document.createDocumentFragment();
                items.forEach(function (item) {
			var row = document.createElement('div');
			row.className = 'row';
                        var idSpan = document.createElement('span');
                        idSpan.textContent = item.id;
                        idSpan.style.opacity = '0.9';
                        idSpan.style.marginRight = '12px';
                        row.appendChild(idSpan);
                        (item.players || []).forEach(function (pid) {
                                var nameEl = document.createElement(adminUserId && pid === adminUserId ? 'strong' : 'span');
                                nameEl.textContent = usernameMap[pid] || pid;
                                nameEl.title = pid;
                                nameEl.style.marginRight = '10px';
                                row.appendChild(nameEl);
                        });
                        frag.appendChild(row);
                });
                targetEl.appendChild(frag);
        }

        socket.on('connect', function () {
                fetchAllUsers();
        });
        socket.on('admin:metrics', function (payload) {
                if (!payload) return;
                latestMetrics = payload;
                if (payload.usernames) {
                        Object.keys(payload.usernames).forEach(function (k) {
                                usernameMap[k] = payload.usernames[k];
                        });
                }
                connectedUsersEl.textContent = (payload.connectedUsers ?? 0);
                quickplayQueueEl.textContent = (payload.quickplayQueue ?? 0);
                rankedQueueEl.textContent = (payload.rankedQueue ?? 0);
                renderList(quickplayQueueListEl, payload.quickplayQueueUserIds);
                renderList(rankedQueueListEl, payload.rankedQueueUserIds);
                renderGameOrMatchList(gamesListEl, payload.games);
                renderGameOrMatchList(matchesListEl, payload.matches);
                fetchAllUsers();
        });

	if (purgeBtn) {
		purgeBtn.addEventListener('click', async function () {
			if (!confirm('Are you sure you want to purge ALL games from the database? This cannot be undone.')) return;
			try {
				var res = await fetch('/api/v1/games/purge', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						// Optionally provide ADMIN_SECRET via prompt if not in env for local testing
						'x-admin-secret': (localStorage.getItem('ADMIN_SECRET') || '')
					}
				});
				if (!res.ok) {
					alert('Failed to purge games: ' + res.status);
					return;
				}
				var data = await res.json();
				alert('Purged games: ' + (data.deleted || 0));
			} catch (err) {
				console.error(err);
				alert('Error purging games. Check console.');
			}
		});
	}

        if (purgeMatchesBtn) {
                purgeMatchesBtn.addEventListener('click', async function () {
                        if (!confirm('Are you sure you want to purge ALL matches from the database? This cannot be undone.')) return;
                        try {
                                var res = await fetch('/api/v1/matches/purge', {
                                        method: 'POST',
                                        headers: {
                                                'Content-Type': 'application/json',
                                                'x-admin-secret': (localStorage.getItem('ADMIN_SECRET') || '')
                                        }
                                });
                                if (!res.ok) {
                                        alert('Failed to purge matches: ' + res.status);
                                        return;
                                }
                                var data = await res.json();
                                alert('Purged matches: ' + (data.deleted || 0));
                        } catch (err) {
                                console.error(err);
                                alert('Error purging matches. Check console.');
                        }
                });
        }

        if (purgeUsersBtn) {
                purgeUsersBtn.addEventListener('click', async function () {
                        if (!confirm('Are you sure you want to purge ALL user accounts from the database? This cannot be undone.')) return;
                        try {
                                var res = await fetch('/api/v1/users/purge', {
                                        method: 'POST',
                                        headers: {
                                                'Content-Type': 'application/json',
                                                'x-admin-secret': (localStorage.getItem('ADMIN_SECRET') || '')
                                        }
                                });
                                if (!res.ok) {
                                        alert('Failed to purge users: ' + res.status);
                                        return;
                                }
                                var data = await res.json();
                                alert('Purged users: ' + (data.deleted || 0));
                        } catch (err) {
                                console.error(err);
                                alert('Error purging users. Check console.');
                        }
                });
        }
})();


