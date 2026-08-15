'use strict' /**
 * Shared Go Fish card helpers for interface + replay.
 * Exposes globalThis.GoFishCards.
 */
;(function (global) {
	const CARD_BACK = '🂠'
	const CARD_ORIGIN_1 = '🂡'.charCodeAt(1)
	const STYLE_KEY = 'Arena-Go-Fish.cardStyle'
	const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'C', 'Q', 'K']
	const SUIT_LABELS = ['♠', '♥', '♦', '♣']
	const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs']

	/** @type {'unicode' | 'text'} */
	let style = 'unicode'
	/** @type {Set<() => void>} */
	const listeners = new Set()

	function readStoredStyle() {
		try {
			const value = global.localStorage?.getItem(STYLE_KEY)
			return value === 'text' ? 'text' : 'unicode'
		} catch {
			return 'unicode'
		}
	}

	function persistStyle(next) {
		try {
			global.localStorage?.setItem(STYLE_KEY, next)
		} catch {
			/* ignore quota / private mode */
		}
	}

	function getStyle() {
		return style
	}

	function setStyle(next) {
		const resolved = next === 'text' ? 'text' : 'unicode'
		if (style === resolved) return
		style = resolved
		persistStyle(style)
		for (const listener of listeners) listener()
	}

	function onStyleChange(listener) {
		listeners.add(listener)
		return () => listeners.delete(listener)
	}

	function bootStyle(checkbox) {
		style = readStoredStyle()
		if (checkbox) {
			checkbox.checked = style === 'text'
			checkbox.addEventListener('change', () => {
				setStyle(checkbox.checked ? 'text' : 'unicode')
			})
		}
		onStyleChange(() => {
			if (checkbox) checkbox.checked = style === 'text'
		})
		return style
	}

	function cardFace(card) {
		if (typeof card === 'string') return card
		if (card && typeof card === 'object') {
			if (typeof card.value === 'string') return card.value
			if (typeof card.card === 'string') return card.card
		}
		return CARD_BACK
	}

	function cardDeck(card) {
		if (card && typeof card === 'object' && Number.isFinite(card.deck)) {
			return card.deck
		}
		return 0
	}

	function cardRank(card) {
		const face = cardFace(card)
		if (face.length < 2) return 0
		return (face.charCodeAt(1) - CARD_ORIGIN_1) % 16
	}

	function cardSuit(card) {
		const face = cardFace(card)
		if (face.length < 2) return 0
		return Math.floor((face.charCodeAt(1) - CARD_ORIGIN_1) / 16) % 4
	}

	function isRedSuit(card) {
		const suit = cardSuit(card)
		return suit === 1 || suit === 2
	}

	function rankLabel(card) {
		return RANK_LABELS[cardRank(card)] ?? '?'
	}

	function suitLabel(card) {
		return SUIT_LABELS[cardSuit(card)] ?? ''
	}

	function deckColor(deck) {
		const hue = ((Number(deck) || 0) * 0.17 + 0.08) % 1
		return 'hsl(' + Math.round(hue * 360) + ' 70% 42%)'
	}

	function sortHand(hand) {
		return [...hand].sort((a, b) => {
			const rankDiff = cardRank(a) - cardRank(b)
			if (rankDiff !== 0) return rankDiff
			const suitDiff = cardSuit(a) - cardSuit(b)
			if (suitDiff !== 0) return suitDiff
			return cardDeck(a) - cardDeck(b)
		})
	}

	/**
	 * Group cards by rank, preserving relative order within each rank.
	 * @param {unknown[]} hand
	 * @returns {unknown[][]}
	 */
	function groupHandByRank(hand) {
		/** @type {Map<number, unknown[]>} */
		const byRank = new Map()
		for (const card of hand) {
			const rank = cardRank(card)
			let group = byRank.get(rank)
			if (!group) {
				group = []
				byRank.set(rank, group)
			}
			group.push(card)
		}
		return [...byRank.values()]
	}

	/**
	 * @param {unknown[]} group
	 * @returns {[number, number][]} suit index → count, sorted by suit
	 */
	function suitCountsForGroup(group) {
		/** @type {Map<number, number>} */
		const counts = new Map()
		for (const card of group) {
			const suit = cardSuit(card)
			counts.set(suit, (counts.get(suit) ?? 0) + 1)
		}
		return [...counts.entries()].sort((a, b) => a[0] - b[0])
	}

	/**
	 * Fill a face-up card element with unicode glyph or rank+suit text.
	 * Expects the element to use the shared `.card.face` styles.
	 * @param {HTMLElement} el
	 * @param {unknown} card
	 */
	function appendCardFace(el, card, style = getStyle()) {
		const rank = rankLabel(card)
		const suit = suitLabel(card)
		const suitIndex = cardSuit(card)
		el.classList.add('face')
		el.classList.toggle('red', isRedSuit(card))
		el.classList.toggle('style-unicode', style === 'unicode')
		el.classList.toggle('style-text', style === 'text')
		el.title = rank + suit
		el.setAttribute(
			'aria-label',
			rank + ' of ' + (SUIT_NAMES[suitIndex] ?? 'unknown'),
		)

		if (style === 'text') {
			const text = document.createElement('span')
			text.className = 'card-text'
			const rankEl = document.createElement('span')
			rankEl.className = 'card-rank'
			rankEl.textContent = rank
			const suitEl = document.createElement('span')
			suitEl.className = 'card-suit'
			suitEl.textContent = suit
			text.appendChild(rankEl)
			text.appendChild(suitEl)
			el.replaceChildren(text)
			return
		}

		const glyph = document.createElement('span')
		glyph.className = 'card-glyph'
		glyph.textContent = cardFace(card)
		glyph.setAttribute('aria-hidden', 'true')
		el.replaceChildren(glyph)
	}

	global.GoFishCards = {
		CARD_BACK,
		STYLE_KEY,
		getStyle,
		setStyle,
		bootStyle,
		onStyleChange,
		cardFace,
		cardDeck,
		cardRank,
		cardSuit,
		isRedSuit,
		rankLabel,
		suitLabel,
		deckColor,
		sortHand,
		groupHandByRank,
		suitCountsForGroup,
		appendCardFace,
	}
})(globalThis)
