'use strict'
function _a() {
	const {
		CARD_BACK,
		cardDeck,
		cardSuit,
		isRedSuit,
		deckColor,
		sortHand,
		groupHandByRank,
		suitCountsForGroup,
		appendCardFace,
		rankLabel,
		suitLabel,
		bootStyle,
		onStyleChange,
	} = GoFishCards

	ReplayHelper.init((replay) => {
		const seatsEl = document.getElementById('seats')
		const pondEl = document.getElementById('pond')
		const pondLabel = document.getElementById('pond-label')
		const tickPill = document.getElementById('tick-pill')
		const pondPill = document.getElementById('pond-pill')
		const slider = document.getElementById('slider')
		const play = document.getElementById('play')
		const buttonBack = document.getElementById('step-back')
		const buttonNext = document.getElementById('step-next')
		const selectMatches = document.getElementById('matches')
		const scoreBoard = document.getElementById('score-board')

		const MS_PER_TICK = 450
		const ASK_LOG_LIMIT = 6
		const REVEAL_POND_KEY = 'Arena-Go-Fish.revealPond'
		const COMPACT_POND_KEY = 'Arena-Go-Fish.compactPond'
		const STACK_BY_RANK_KEY = 'Arena-Go-Fish.stackByRank'

		let activeMatchLog = null
		let ticksCache = []
		/** Asks between the previous state and this one; index matches ticksCache. */
		let asksByTick = []
		let pendingAsks = []
		let lastLogRowId = 0
		let lastPlayTimestamp = null
		let pullQueue = Promise.resolve()
		let pollGeneration = 0
		const matchCompleted = []
		const teams = replay.arenaResult.teams ?? []

		/** @type {Map<number, number>} card id → stable pond slot from first logged state */
		let pondSlotById = new Map()
		let pondSlotCount = 0

		const revealPondEl = document.getElementById('reveal-pond')
		const compactPondEl = document.getElementById('compact-pond')
		const stackByRankEl = document.getElementById('stack-by-rank')

		function readStoredFlag(key, defaultValue = false) {
			try {
				const value = localStorage.getItem(key)
				if (value === null) return defaultValue
				return value === '1'
			} catch {
				return defaultValue
			}
		}

		function persistFlag(key, value) {
			try {
				localStorage.setItem(key, value ? '1' : '0')
			} catch {
				/* ignore */
			}
		}

		revealPondEl.checked = readStoredFlag(REVEAL_POND_KEY)
		compactPondEl.checked = readStoredFlag(COMPACT_POND_KEY)
		stackByRankEl.checked = readStoredFlag(STACK_BY_RANK_KEY, true)

		bootStyle(document.getElementById('card-style-text'))
		onStyleChange(() => setTick(slider.valueAsNumber))
		revealPondEl.addEventListener('change', () => {
			persistFlag(REVEAL_POND_KEY, revealPondEl.checked)
			setTick(slider.valueAsNumber)
		})
		compactPondEl.addEventListener('change', () => {
			persistFlag(COMPACT_POND_KEY, compactPondEl.checked)
			setTick(slider.valueAsNumber)
		})
		stackByRankEl.addEventListener('change', () => {
			persistFlag(STACK_BY_RANK_KEY, stackByRankEl.checked)
			setTick(slider.valueAsNumber)
		})

		function memberColor(teamIndex, memberIndex = 0) {
			return teams[teamIndex]?.members?.[memberIndex]?.color?.RGB ??
				teams[teamIndex]?.color?.RGB ??
				'#fff'
		}

		function memberName(teamIndex, memberIndex = 0) {
			return teams[teamIndex]?.members?.[memberIndex]?.name ?? ('Player ' + (teamIndex + 1))
		}

		/** @param {HTMLElement} el @param {unknown[]} group */
		function appendSuitCountBadges(el, group) {
			const wrap = document.createElement('span')
			wrap.className = 'card-suit-counts'
			for (const [suit, count] of suitCountsForGroup(group)) {
				const sample = group.find((card) => cardSuit(card) === suit)
				const badge = document.createElement('span')
				badge.className = 'suit-count'
				if (sample && isRedSuit(sample)) badge.classList.add('red')
				const countEl = document.createElement('span')
				countEl.className = 'suit-count-num'
				countEl.textContent = String(count)
				const suitEl = document.createElement('span')
				suitEl.className = 'suit-count-mark'
				suitEl.textContent = sample ? suitLabel(sample) : '?'
				badge.appendChild(countEl)
				badge.appendChild(suitEl)
				badge.title = sample ? `${count}× ${suitLabel(sample)}` : String(count)
				wrap.appendChild(badge)
			}
			el.appendChild(wrap)
			el.classList.add('has-suit-counts')
		}

		function seatPositions(count) {
			if (count <= 0) return []
			if (count === 1) {
				return [{ left: '50%', top: '82%' }]
			}
			if (count === 2) {
				return [
					{ left: '50%', top: '84%' },
					{ left: '50%', top: '16%' },
				]
			}
			if (count === 3) {
				return [
					{ left: '50%', top: '86%' },
					{ left: '16%', top: '28%' },
					{ left: '84%', top: '28%' },
				]
			}
			if (count === 4) {
				return [
					{ left: '50%', top: '86%' },
					{ left: '12%', top: '48%' },
					{ left: '50%', top: '14%' },
					{ left: '88%', top: '48%' },
				]
			}
			const positions = []
			for (let i = 0; i < count; i++) {
				const angle = Math.PI / 2 + (i / count) * Math.PI * 2
				const x = 50 + Math.cos(angle) * 40
				const y = 50 + Math.sin(angle) * 38
				positions.push({ left: x + '%', top: y + '%' })
			}
			return positions
		}

		function escapeHtml(text) {
			return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
		}

		function rebuildScoreboard() {
			let html = '<table><tr><th>Team</th><th>Name</th><th>Score</th></tr>'
			const last = replay.arenaResult.match[replay.arenaResult.match.length - 1]
			if (last?.scores) {
				const sorted = [...last.scores].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
				for (const score of sorted) {
					for (let memberIndex = 0; memberIndex < score.members.length; memberIndex++) {
						const member = score.members[memberIndex]
						html += '<tr style="color:' + memberColor(score.team, memberIndex) + '"><td>' +
							(score.team + 1) + '</td><td>' + escapeHtml(member.name) + '</td><td>' +
							(score.score ?? 0) + '</td></tr>'
					}
				}
			}
			html += '</table>'
			scoreBoard.innerHTML = html
		}

		void replay.onAbort.then(rebuildScoreboard)

		function handCardFontSize(totalFaceUp, handSize) {
			const byTotal = totalFaceUp > 48 ? 1.5 : totalFaceUp > 36 ? 1.95 : totalFaceUp > 24 ? 2.5 : totalFaceUp > 16 ? 3.05 : 3.75
			const byHand = handSize > 18 ? 1.55 : handSize > 14 ? 2 : handSize > 10 ? 2.5 : handSize > 7 ? 3.05 : 3.75
			return Math.min(byTotal, byHand) + 'rem'
		}

		function asksThroughTick(index) {
			const asks = []
			const end = Math.min(index, asksByTick.length - 1)
			for (let i = 0; i <= end; i++) {
				const batch = asksByTick[i]
				if (Array.isArray(batch) && batch.length) asks.push(...batch)
			}
			if (index >= ticksCache.length - 1 && pendingAsks.length) {
				asks.push(...pendingAsks)
			}
			return asks
		}

		function formatAskLine(ask) {
			const asked = memberName(ask.playerAsked)
			const rank = rankLabel(ask.card)
			const result = Number(ask.result) || 0
			return result ? 'Asked ' + asked + ' for ' + rank + ' — got ' + result : 'Asked ' + asked + ' for ' + rank + ' — go fish'
		}

		function syncPondLayout() {
			const firstPond = ticksCache[0]?.value?.pond
			if (!Array.isArray(firstPond) || firstPond.length === 0) return
			if (pondSlotCount === firstPond.length && pondSlotById.size === firstPond.length) return
			pondSlotById = new Map()
			firstPond.forEach((card, index) => {
				if (card && Number.isFinite(card.id)) pondSlotById.set(card.id, index)
			})
			pondSlotCount = firstPond.length
		}

		function cardSlot(card) {
			if (card && Number.isFinite(card.id) && pondSlotById.has(card.id)) {
				return pondSlotById.get(card.id)
			}
			return null
		}

		function appendPondCard(card, index, fontSize, reveal) {
			const el = document.createElement('div')
			el.className = 'card'
			if (fontSize) el.style.fontSize = fontSize
			if (reveal) {
				appendCardFace(el, card)
				if (1 < replay.arenaResult.settings.deck.numberOfDecks) {
					el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35), inset 0 -3px 0 ' +
						deckColor(cardDeck(card))
				}
			} else {
				el.textContent = CARD_BACK
				el.style.color = deckColor(cardDeck(card))
				el.title = 'Pond card #' + index
			}
			pondEl.appendChild(el)
		}

		function appendPondGap(fontSize) {
			const gap = document.createElement('span')
			gap.className = 'card pond-gap'
			gap.setAttribute('aria-hidden', 'true')
			if (fontSize) gap.style.fontSize = fontSize
			pondEl.appendChild(gap)
		}

		function renderPond(pond) {
			pondEl.replaceChildren()
			syncPondLayout()
			const cards = Array.isArray(pond) ? pond : []
			const n = cards.length
			pondLabel.textContent = n ? 'Pond · ' + n : 'Pond · empty'
			pondPill.textContent = n ? 'Pond · ' + n : 'Pond · empty'
			const slotCount = Math.max(pondSlotCount, n)
			const layoutSize = compactPondEl.checked ? n : slotCount
			const fontSize = layoutSize > 40 ? '1.2rem' : layoutSize > 24 ? '1.55rem' : ''
			const reveal = revealPondEl.checked

			if (compactPondEl.checked || pondSlotCount === 0) {
				for (let i = 0; i < n; i++) {
					appendPondCard(cards[i], i, fontSize, reveal)
				}
				return
			}

			const slots = new Array(pondSlotCount).fill(null)
			for (const card of cards) {
				const slot = cardSlot(card)
				if (slot != null && slot < slots.length) slots[slot] = card
				else {
					// Card missing from layout (should be rare) — append after known slots.
					slots.push(card)
				}
			}
			for (let i = 0; i < slots.length; i++) {
				const card = slots[i]
				if (card) appendPondCard(card, i, fontSize, reveal)
				else appendPondGap(fontSize)
			}
		}

		function renderSeats(participants, asks) {
			seatsEl.replaceChildren()
			const hands = Array.isArray(participants) ? participants : []
			const count = Math.max(hands.length, teams.length, 2)
			const positions = seatPositions(count)
			let totalFaceUp = 0
			for (let team = 0; team < count; team++) {
				const hand = Array.isArray(hands[team]) ? hands[team] : []
				totalFaceUp += hand.length
			}
			const asksList = Array.isArray(asks) ? asks : []

			for (let team = 0; team < count; team++) {
				const hand = Array.isArray(hands[team]) ? hands[team] : []
				const pos = positions[team] ?? { left: '50%', top: '50%' }
				const seat = document.createElement('div')
				seat.className = 'seat'
				seat.style.left = pos.left
				seat.style.top = pos.top

				const label = document.createElement('div')
				label.className = 'seat-label'
				const swatch = document.createElement('span')
				swatch.className = 'seat-swatch'
				swatch.style.background = memberColor(team)
				label.appendChild(swatch)
				label.appendChild(document.createTextNode(memberName(team)))

				const meta = document.createElement('div')
				meta.className = 'seat-meta'
				meta.textContent = hand.length + (hand.length === 1 ? ' card' : ' cards')

				const handEl = document.createElement('div')
				handEl.className = 'seat-hand'
				const cardSize = handCardFontSize(totalFaceUp, hand.length)
				handEl.style.setProperty('--card-size', cardSize)
				const sorted = sortHand(hand)
				const stackByRank = !!stackByRankEl.checked
				handEl.classList.toggle('stack-by-rank', stackByRank)
				if (sorted.length === 0) {
					const empty = document.createElement('span')
					empty.className = 'card empty-mark'
					empty.textContent = 'empty'
					handEl.appendChild(empty)
				} else {
					const groups = stackByRank ? groupHandByRank(sorted) : sorted.map((card) => [card])
					for (const group of groups) {
						const stack = document.createElement('div')
						stack.className = 'rank-stack'
						group.forEach((card, stackIndex) => {
							const el = document.createElement('div')
							el.className = 'card'
							const isTop = stackIndex === group.length - 1
							const inStack = stackByRank && group.length > 1
							appendCardFace(el, card)
							if (inStack) {
								el.style.setProperty('--stack-z', String(20 + stackIndex))
								el.style.setProperty('--stack-depth', String(stackIndex - (group.length - 1)))
								el.classList.toggle('stacked-under', !isTop)
								if (isTop) appendSuitCountBadges(el, group)
							}
							if (1 < replay.arenaResult.settings.deck.numberOfDecks) {
								el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35), inset 0 -3px 0 ' +
									deckColor(cardDeck(card))
							}
							stack.appendChild(el)
						})
						handEl.appendChild(stack)
					}
				}

				const askLog = document.createElement('div')
				askLog.className = 'seat-ask-log'
				const mine = asksList.filter((ask) => ask.askingPlayer === team)
				const recent = mine.slice(-ASK_LOG_LIMIT)
				if (recent.length === 0) {
					const emptyAsk = document.createElement('div')
					emptyAsk.className = 'ask-entry muted'
					emptyAsk.textContent = 'No asks yet'
					askLog.appendChild(emptyAsk)
				} else {
					for (const ask of recent) {
						const row = document.createElement('div')
						row.className = 'ask-entry'
						if (!(Number(ask.result) > 0)) row.classList.add('go-fish')
						row.textContent = formatAskLine(ask)
						askLog.appendChild(row)
					}
					askLog.scrollTop = askLog.scrollHeight
				}

				seat.appendChild(label)
				seat.appendChild(meta)
				seat.appendChild(handEl)
				seat.appendChild(askLog)
				seatsEl.appendChild(seat)
			}
		}

		function drawFrame(tick, index) {
			tickPill.textContent = 'Tick ' + (index + 1) + ' / ' + Math.max(ticksCache.length, 1)
			const state = tick?.value
			if (!state) {
				renderPond([])
				renderSeats([], [])
				return
			}
			renderPond(state.pond)
			renderSeats(state.participants, asksThroughTick(index))
		}

		function syncSliderMax() {
			slider.max = String(Math.max(0, ticksCache.length - 1))
		}

		async function pullTicksInner(generation) {
			if (!activeMatchLog || generation !== pollGeneration) return { hadNew: false }
			const cacheBefore = ticksCache.length
			const newEntries = await activeMatchLog.log.getSince(lastLogRowId)
			if (generation !== pollGeneration) return { hadNew: false }
			for (const entry of newEntries) {
				if (entry.id != null && entry.id > lastLogRowId) lastLogRowId = entry.id
				if (entry.type === 'ask' && entry.value) {
					pendingAsks.push(entry.value)
				} else if (entry.type === 'state') {
					asksByTick.push(pendingAsks)
					pendingAsks = []
					ticksCache.push({ type: entry.type, value: entry.value })
				}
			}
			syncSliderMax()
			return { hadNew: ticksCache.length > cacheBefore }
		}

		function enqueuePullTicks() {
			const generation = pollGeneration
			pullQueue = pullQueue.then(() => pullTicksInner(generation))
			return pullQueue
		}

		function startLogPolling(generation, matchIndex) {
			const repeat = () => {
				if (generation !== pollGeneration) return
				enqueuePullTicks().then((result) => {
					if (generation !== pollGeneration) return
					if (matchCompleted[matchIndex]) return
					if (play.value !== '▶') setTick(slider.valueAsNumber)
					if (result?.hadNew) repeat()
					else requestAnimationFrame(repeat)
				})
			}
			repeat()
		}

		function setTick(index) {
			const tick = ticksCache[index] ?? null
			drawFrame(tick, index)
			buttonBack.disabled = index <= 0
			buttonNext.disabled = index >= ticksCache.length - 1 || ticksCache.length === 0
		}

		slider.oninput = () => {
			play.value = '▶'
			lastPlayTimestamp = null
			setTick(slider.valueAsNumber)
		}

		selectMatches.onchange = () => {
			pollGeneration++
			const generation = pollGeneration
			const idx = parseInt(selectMatches.selectedOptions[0].dataset.index, 10)
			activeMatchLog = replay.arenaResult.match[idx]
			ticksCache = []
			asksByTick = []
			pendingAsks = []
			lastLogRowId = 0
			pondSlotById = new Map()
			pondSlotCount = 0
			slider.value = '0'
			slider.max = '0'
			void enqueuePullTicks().then(() => {
				if (generation !== pollGeneration) return
				setTick(0)
				play.onclick()
			})
			void activeMatchLog.log.awaitCompletion().then(async () => {
				if (generation !== pollGeneration) return
				matchCompleted[idx] = true
				await enqueuePullTicks()
				if (generation !== pollGeneration) return
				rebuildScoreboard()
				setTick(slider.valueAsNumber)
			})
			startLogPolling(generation, idx)
		}

		play.onclick = () => {
			if (play.value === '▶') {
				play.value = '❚❚'
				lastPlayTimestamp = null
			} else {
				play.value = '▶'
				lastPlayTimestamp = null
			}
		}

		buttonBack.onclick = () => {
			play.value = '▶'
			lastPlayTimestamp = null
			slider.valueAsNumber = Math.max(0, slider.valueAsNumber - 1)
			setTick(slider.valueAsNumber)
		}
		buttonNext.onclick = () => {
			play.value = '▶'
			lastPlayTimestamp = null
			slider.valueAsNumber = Math.min(ticksCache.length - 1, slider.valueAsNumber + 1)
			setTick(slider.valueAsNumber)
		}

		function playFrame(timestamp) {
			if (play.value !== '▶') {
				if (lastPlayTimestamp == null) lastPlayTimestamp = timestamp
				if (MS_PER_TICK <= timestamp - lastPlayTimestamp) {
					lastPlayTimestamp = timestamp
					if (slider.valueAsNumber < ticksCache.length - 1) {
						slider.valueAsNumber += 1
						setTick(slider.valueAsNumber)
					} else if (matchCompleted[parseInt(selectMatches.selectedOptions[0]?.dataset.index, 10)]) {
						play.value = '▶'
						lastPlayTimestamp = null
					}
				}
			} else {
				lastPlayTimestamp = timestamp
			}
			requestAnimationFrame(playFrame)
		}
		requestAnimationFrame(playFrame)

		for (let i = 0; i < replay.arenaResult.match.length; i++) {
			const opt = document.createElement('option')
			opt.textContent = 'Match ' + (i + 1)
			opt.dataset.index = String(i)
			selectMatches.appendChild(opt)
		}
		if (replay.arenaResult.match.length === 1) {
			selectMatches.style.display = 'none'
		}
		selectMatches.dispatchEvent(new Event('change'))
	})
}
