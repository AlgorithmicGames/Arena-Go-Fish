'use strict'
let _participants
let _settings
let _teams

const cardPond = []

function shuffle(array) { // Source: https://stackoverflow.com/a/2450976
	let currentIndex = array.length
	while (currentIndex != 0) {
		let randomIndex = Math.floor(Math.random() * currentIndex)
		currentIndex--
		;[array[currentIndex], array[randomIndex]] = [
			array[randomIndex],
			array[currentIndex],
		]
	}
}

function responseData(response) {
	return response && response.message ? response.message.data : undefined
}

function normalizeCardIndex(value) {
	if (!Number.isFinite(value)) {
		value = 0
	}
	value %= cardPond.length
	if (value < 0) {
		value += cardPond.length
	}
	return value
}

async function minimalHandPickUp(participant) {
	while (0 < cardPond.length && participant.payload.hand.length < _settings.rules.minHandSize) {
		await pickUp(participant)
	}
}

async function pickUp(participant) {
	if (cardPond.length === 0) {
		return
	}
	const { hand, worker } = participant.payload
	return worker.postMessage({
		type: 'pick-up',
		pond: cardPond.length,
	}).then((response) => {
		const cardIndex = normalizeCardIndex(responseData(response))
		const card = cardPond.splice(cardIndex, 1)
		hand.push(...card)
		return worker.postMessage({
			type: 'pick-up-result',
			card,
			hand,
		})
	})
}

function checkPairs() {
	const promises = []
	let score = 0
	_participants.forEach((participant) => {
		promises.push(
			new Promise(async (resolve) => {
				let pairFound = true
				do {
					pairFound = false
					for (let j = 0; j < 14; j++) {
						const spade = getCard(j)
						const heart = getCard(j + 16)
						const diamond = getCard(j + 32)
						const club = getCard(j + 48)

						const foundSpade = participant.payload.hand.findIndex((c) => c.card === spade)
						const foundHeart = participant.payload.hand.findIndex((c) => c.card === heart)
						const foundDiamond = participant.payload.hand.findIndex((c) => c.card === diamond)
						const foundClub = participant.payload.hand.findIndex((c) => c.card === club)
						if (-1 < Math.min(foundSpade, foundHeart, foundDiamond, foundClub)) {
							pairFound = true
							;[foundSpade, foundHeart, foundDiamond, foundClub].sort((a, b) => b - a).forEach((index) => {
								participant.payload.hand.splice(index, 1)
							})
							participant.addScore(1)
							score++
							await minimalHandPickUp(participant)
						}
					}
				} while (pairFound)
				resolve()
			}),
		)
	})
	if (0 < score) {
		logState()
	}
	return Promise.all(promises)
}

function getCard(index) {
	const cardOrigin_0 = '🂡'.charCodeAt(0)
	const cardOrigin_1 = '🂡'.charCodeAt(1)
	return String.fromCharCode(cardOrigin_0, cardOrigin_1 + index)
}

let lastState = ''
function logState() {
	const state = {
		pond: cardPond,
		participants: [],
	}
	_participants.forEach((player) => {
		state.participants[player.team] = player.payload.hand
	})
	const stateString = JSON.stringify(state)
	if (stateString === lastState) {
		return
	}
	lastState = stateString
	ArenaHelper.log('state', state)
}

function countCardsInPlay() {
	let cardsInPlay = cardPond.length
	_participants.forEach((participant) => {
		cardsInPlay += participant.payload.hand.length
	})
	return cardsInPlay
}

function matchIsOver() {
	return countCardsInPlay() === 0
}

function getNextPlayer(participant) {
	return _participants.get((participant.team + 1) % _teams, 0)
}

function doAsk(playerAsking) {
	logState()
	if (matchIsOver()) {
		ArenaHelper.postDone()
		return
	}
	if (playerAsking.payload.hand.length === 0) {
		const nextPlayer = getNextPlayer(playerAsking)
		doAsk(nextPlayer)
		return
	}
	playerAsking.payload.worker.postMessage({
		type: 'ask',
		hand: playerAsking.payload.hand,
		opponentsHandSizes: _participants.toArray().map((p) => playerAsking !== p ? p.payload.hand.length : null),
		pond: cardPond.map((c) => c.deck),
	}).then(async (response) => {
		const { player, cardId } = responseData(response) ?? {}
		const playerAsked = Number.isInteger(player) && 0 <= player && player < _teams ? _participants.get(player, 0) : null
		const card = playerAsking.payload.hand.find((c) => c.id === cardId)
		if (!playerAsked || playerAsking === playerAsked || !card) {
			const nextPlayer = getNextPlayer(playerAsking)
			doAsk(nextPlayer)
			return
		}
		const indexes = playerAsked.payload.hand.map((c, index) => card.rank === c.rank ? index : null).filter((index) => index !== null)
		const cardFound = 0 < indexes.length
		const foundCards = []

		ArenaHelper.log('ask', {
			askingPlayer: playerAsking.team,
			playerAsked: playerAsked.team,
			card: card,
			result: indexes.length,
		})

		if (cardFound) {
			indexes.reverse()
			indexes.forEach((index) => {
				foundCards.push(playerAsked.payload.hand[index])
				playerAsked.payload.hand.splice(index, 1)
			})
			foundCards.reverse()
			playerAsking.payload.hand.push(...foundCards)
			await checkPairs()
			logState()
		}

		minimalHandPickUp(playerAsked).then(async () => {
			_participants.forEach((player) => {
				player.payload.worker.postMessage({
					type: 'hand-update',
					askingPlayer: playerAsking.team,
					playerAsked: playerAsked.team,
					card: card,
					result: foundCards.length,
					hand: player.payload.hand,
				})
			})

			if (cardFound) {
				doAsk(playerAsking)
			} else {
				new Promise((resolve) => {
					if (cardPond.length === 0) {
						resolve()
					} else {
						playerAsking.payload.worker.postMessage({
							type: 'go-fish',
							pond: cardPond.map((c) => c.deck),
						}).then((response) => {
							const cardIndex = normalizeCardIndex(responseData(response))
							const card = cardPond.splice(cardIndex, 1)
							playerAsking.payload.hand.push(...card)
							logState()
							playerAsking.payload.worker.postMessage({
								type: 'go-fish-result',
								card: card,
								hand: playerAsking.payload.hand,
							})
						}).then(resolve)
					}
				}).then(async () => {
					await checkPairs()

					if (_settings.rules.nextPlayer === 'Asked') {
						doAsk(playerAsked)
					} else {
						doAsk(getNextPlayer(playerAsked))
					}
				})
			}
		})
	})
}

ArenaHelper.init = ({ participants, settings, reject, dependencies }) => {
	_participants = participants
	_settings = settings

	let cardId = 0
	for (let i = 0; i < _settings.deck.numberOfDecks; i++) {
		for (let s = 0; s < 4; s++) {
			const suit = s * 16
			for (let rank = 0; rank < 14; rank++) {
				if (!_settings.deck.knights && rank === 11) {
					continue
				}
				cardPond.push({
					id: cardId++,
					card: getCard(suit + rank),
					deck: i,
					suit: s,
					rank,
				})
			}
		}
	}

	if (cardPond.length < _participants.countMembers() * settings.rules.startingHandSize) {
		reject('Did-Not-Start', 'Not enough cards to start the game.')
	}
	shuffle(cardPond)

	const promises = []
	_participants.forEach((participant) => {
		participant.payload.hand = cardPond.splice(0, _settings.rules.startingHandSize)
		promises.push(
			participant.addWorker().then((worker) => {
				participant.payload.worker = worker
				return worker.postMessage({
					type: 'starting-hand',
					hand: participant.payload.hand,
				})
			}),
		)
	})
	logState()
	Promise.all(promises).then(async () => {
		_teams = _participants.countTeams()
		const startingPlayer = _settings.rules.startingPlayer === 'Random' ? Math.floor(Math.random() * _teams) : 0
		await checkPairs()
		doAsk(_participants.get(startingPlayer, 0))
	})
}
