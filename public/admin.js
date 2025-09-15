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

        function renderUsersList(targetEl, users, connectedIds, matches) {
                if (!targetEl) return;
                targetEl.innerHTML = '';
                if (!Array.isArray(users) || users.length === 0) return;
                var connectedSet = new Set(connectedIds || []);
                var inMatchSet = new Set();
                if (Array.isArray(matches)) {
                        matches.forEach(function (match) {
                                (match && Array.isArray(match.players) ? match.players : []).forEach(function (pid) {
                                        if (pid) inMatchSet.add(pid);
                                });
                        });
                }
                users.sort(function (a, b) {
                        return (connectedSet.has(b.id) - connectedSet.has(a.id)) || (a.username || '').localeCompare(b.username || '');
                });
                var frag = document.createDocumentFragment();
                var matchCells = [];
                var connCells = [];
                var header = document.createElement('div');
                header.className = 'row headerRow';
                header.style.display = 'flex';
                header.style.alignItems = 'center';
                header.style.justifyContent = 'flex-start';
                header.style.gap = '12px';
                var hName = document.createElement('span');
                hName.textContent = 'Username';
                hName.style.flex = '1 1 auto';
                hName.style.minWidth = '0';
                var hMatch = document.createElement('span');
                hMatch.textContent = 'In Match';
                hMatch.style.display = 'inline-flex';
                hMatch.style.justifyContent = 'center';
                hMatch.style.alignItems = 'center';
                hMatch.style.whiteSpace = 'nowrap';
                hMatch.style.wordBreak = 'keep-all';
                var hConn = document.createElement('span');
                hConn.textContent = 'Connected';
                hConn.style.display = 'inline-flex';
                hConn.style.justifyContent = 'center';
                hConn.style.alignItems = 'center';
                hConn.style.whiteSpace = 'nowrap';
                hConn.style.wordBreak = 'keep-all';
                header.appendChild(hName);
                header.appendChild(hMatch);
                header.appendChild(hConn);
                matchCells.push(hMatch);
                connCells.push(hConn);
                frag.appendChild(header);
                function createDaggerTokenIcon() {
                        var token = document.createElement('div');
                        var size = 18;
                        token.style.width = size + 'px';
                        token.style.height = size + 'px';
                        token.style.borderRadius = '50%';
                        token.style.border = '2px solid var(--CG-white)';
                        token.style.background = 'var(--CG-dark-red)';
                        token.style.display = 'flex';
                        token.style.alignItems = 'center';
                        token.style.justifyContent = 'center';
                        token.style.color = 'var(--CG-white)';
                        token.style.fontWeight = 'bold';
                        token.style.fontSize = '12px';
                        token.style.lineHeight = '1';
                        token.textContent = '⚔';
                        token.setAttribute('aria-hidden', 'true');
                        return token;
                }
                users.forEach(function (u) {
                        var row = document.createElement('div');
                        row.className = 'row';
                        row.style.display = 'flex';
                        row.style.alignItems = 'center';
                        row.style.justifyContent = 'flex-start';
                        row.style.gap = '12px';
                        var nameEl = document.createElement(adminUserId && u.id === adminUserId ? 'strong' : 'span');
                        nameEl.textContent = u.username || 'Unknown';
                        nameEl.title = u.id;
                        nameEl.style.flex = '1 1 auto';
                        nameEl.style.minWidth = '0';
                        var matchEl = document.createElement('span');
                        matchEl.style.display = 'inline-flex';
                        matchEl.style.justifyContent = 'center';
                        matchEl.style.alignItems = 'center';
                        matchEl.style.whiteSpace = 'nowrap';
                        matchEl.style.wordBreak = 'keep-all';
                        matchEl.style.padding = '0 2px';
                        if (inMatchSet.has(u.id)) {
                                matchEl.appendChild(createDaggerTokenIcon());
                                matchEl.title = 'Player is in an active match';
                                matchEl.setAttribute('aria-label', 'In active match');
                        } else {
                                matchEl.setAttribute('aria-label', 'Not in active match');
                        }
                        var connEl = document.createElement('span');
                        connEl.style.display = 'inline-flex';
                        connEl.style.justifyContent = 'center';
                        connEl.style.alignItems = 'center';
                        connEl.style.whiteSpace = 'nowrap';
                        connEl.style.wordBreak = 'keep-all';
                        connEl.style.padding = '0 2px';
                        if (connectedSet.has(u.id)) {
                                var img = document.createElement('img');
                                img.src = 'assets/images/GoldThrone.svg';
                                img.alt = '';
                                img.style.width = '16px';
                                img.style.height = '16px';
                                connEl.appendChild(img);
                        }
                        row.appendChild(nameEl);
                        row.appendChild(matchEl);
                        row.appendChild(connEl);
                        matchCells.push(matchEl);
                        connCells.push(connEl);
                        frag.appendChild(row);
                });
                targetEl.appendChild(frag);
                var matchWidth = 0;
                var connWidth = 0;
                matchCells.forEach(function (cell) {
                        matchWidth = Math.max(matchWidth, Math.ceil(cell.getBoundingClientRect().width));
                });
                connCells.forEach(function (cell) {
                        connWidth = Math.max(connWidth, Math.ceil(cell.getBoundingClientRect().width));
                });
                var setColumnWidth = function (cells, width) {
                        if (!width) return;
                        cells.forEach(function (cell) {
                                cell.style.flex = '0 0 ' + width + 'px';
                                cell.style.maxWidth = width + 'px';
                                cell.style.minWidth = width + 'px';
                        });
                };
                setColumnWidth(matchCells, matchWidth);
                setColumnWidth(connCells, connWidth);
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
                        renderUsersList(
                                usersListEl,
                                users,
                                latestMetrics ? latestMetrics.connectedUserIds : [],
                                latestMetrics ? latestMetrics.matches : []
                        );
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


