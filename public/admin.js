(function () {
	var origin = window.location.origin.replace(/\/$/, '');
	var socket = io(origin + '/admin');
	var params = new URLSearchParams(window.location.search);
	var adminIdParam = params.get('adminId');
	var adminUserId = adminIdParam || localStorage.getItem('cg_userId') || null;
	var connectedUsersEl = document.getElementById('connectedUsers');
	var quickplayQueueEl = document.getElementById('quickplayQueue');
	var rankedQueueEl = document.getElementById('rankedQueue');
	var connectedUsersListEl = document.getElementById('connectedUsersList');
	var quickplayQueueListEl = document.getElementById('quickplayQueueList');
	var rankedQueueListEl = document.getElementById('rankedQueueList');
	var gamesListEl = document.getElementById('gamesList');
	var matchesListEl = document.getElementById('matchesList');
	var purgeBtn = document.getElementById('purgeGamesBtn');
	var purgeMatchesBtn = document.getElementById('purgeMatchesBtn');

	function userIdToHexColor(id) {
		// djb2 hash for stability
		var hash = 5381;
		for (var i = 0; i < id.length; i++) {
			hash = ((hash << 5) + hash) + id.charCodeAt(i); // hash * 33 + c
		}
		// Map to 24-bit color space and keep it vibrant but not too dark
		var r = (hash & 0xFF0000) >> 16;
		var g = (hash & 0x00FF00) >> 8;
		var b = (hash & 0x0000FF);
		// Normalize to avoid extremes: bring channel toward mid by mixing with 128
		var mix = 0.5; // 0..1, mix toward 128
		r = Math.round(r * (1 - mix) + 128 * mix);
		g = Math.round(g * (1 - mix) + 128 * mix);
		b = Math.round(b * (1 - mix) + 128 * mix);
		var toHex = function (n) { var s = n.toString(16); return s.length === 1 ? '0' + s : s; };
		return '#' + toHex(r) + toHex(g) + toHex(b);
	}

	function renderList(targetEl, ids) {
		if (!targetEl) return;
		targetEl.innerHTML = '';
		if (!Array.isArray(ids) || ids.length === 0) return;
		var frag = document.createDocumentFragment();
		ids.forEach(function (id) {
			var row = document.createElement('div');
			row.className = 'row';
			var swatch = document.createElement('span');
			swatch.className = 'swatch';
			swatch.style.backgroundColor = userIdToHexColor(id);
			if (adminUserId && id === adminUserId) {
				var strong = document.createElement('strong');
				strong.textContent = id;
				row.appendChild(swatch);
				row.appendChild(strong);
			} else {
				var span = document.createElement('span');
				span.textContent = id;
				row.appendChild(swatch);
				row.appendChild(span);
			}
			frag.appendChild(row);
		});
		targetEl.appendChild(frag);
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
				var swatch = document.createElement('span');
				swatch.className = 'swatch';
				swatch.style.backgroundColor = userIdToHexColor(pid);
				row.appendChild(swatch);
				if (adminUserId && pid === adminUserId) {
					var strong = document.createElement('strong');
					strong.textContent = pid;
					strong.style.marginRight = '10px';
					row.appendChild(strong);
				} else {
					var span = document.createElement('span');
					span.textContent = pid;
					span.style.marginRight = '10px';
					row.appendChild(span);
				}
			});
			frag.appendChild(row);
		});
		targetEl.appendChild(frag);
	}

	socket.on('connect', function () { /* no-op */ });
	socket.on('admin:metrics', function (payload) {
		if (!payload) return;
		connectedUsersEl.textContent = (payload.connectedUsers ?? 0);
		quickplayQueueEl.textContent = (payload.quickplayQueue ?? 0);
		rankedQueueEl.textContent = (payload.rankedQueue ?? 0);
		renderList(connectedUsersListEl, payload.connectedUserIds);
		renderList(quickplayQueueListEl, payload.quickplayQueueUserIds);
		renderList(rankedQueueListEl, payload.rankedQueueUserIds);
		renderGameOrMatchList(gamesListEl, payload.games);
		renderGameOrMatchList(matchesListEl, payload.matches);
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
})();


