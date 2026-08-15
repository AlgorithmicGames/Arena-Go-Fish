# Go Fish

[Go Fish](https://en.wikipedia.org/wiki/Go_Fish) card arena for [Algorithmic Games](https://algorithmic.games). Collect books of four matching ranks (one per suit), ask opponents for ranks you hold, and draw from the pond when they say “go fish.” Highest score when no cards remain in play wins.

## Rules

- **Players:** at least two teams; one participant per team (`header.limits`).
- **Deal:** each player gets `rules.startingHandSize` cards from a shuffled pond (one or more standard decks; optional knights via `deck.knights`).
- **Books:** whenever a hand holds all four suits of the same rank, those four cards are removed and that player scores **1**. Hands below `rules.minHandSize` are topped up from the pond (`pick-up`).
- **Turn:** the active player receives an `ask` message and names another player plus a **card id from their own hand** (the rank asked for). Matching-rank cards move from the asked player to the asker.
  - **Hit:** asker keeps asking.
  - **Miss:** asker may draw from the pond (`go-fish` when the pond is non-empty), then turn passes per `rules.nextPlayer` (`Asked` = the player who was asked; `Clockwise` = the next team after them).
- **Empty hand on ask:** that player is skipped; the next team asks.
- **End:** when the pond and every hand are empty (all books taken), the match ends. Scores are the books each player completed.

## Cards

Each card object looks like:

```js
{
	id: 0, // unique across the whole match
	card: '🂡', // Unicode playing-card glyph
	deck: 0, // which physical deck (0 .. numberOfDecks-1)
	suit: 0, // 0 spades, 1 hearts, 2 diamonds, 3 clubs
	rank: 0, // 0 Ace … 10 Jack, 11 Knight (if enabled), 12 Queen, 13 King
}
```

Asking uses **`id`**, not `rank` or `card`. You may only ask with an `id` currently in your hand. Success transfers **every** card of that **rank** from the target’s hand.

## Setup

On init you receive match `settings` and `opponents`. Then the arena sends your dealt cards:

**Input**

```js
{
	type: 'starting-hand',
	hand: [/* card objects */],
}
```

**Return:** any value (e.g. `null`). The match waits for a reply before continuing.

## Input (arena → participant)

Every later message is a post whose payload includes a `type` field. Keep your own hand in sync from `hand` whenever it is present.

### `ask` — your turn

```js
{
	type: 'ask',
	hand: [/* your cards */],
	opponentsHandSizes: [null, 5, 3], // your team index is null; others are hand lengths
	pond: [0, 0, 1], // deck index per remaining pond card (faces hidden)
}
```

### `go-fish` — draw after a miss

Sent only when the pond is non-empty.

```js
{
	type: 'go-fish',
	pond: [0, 0, 1], // same encoding as ask.pond
}
```

### `pick-up` — refill toward `minHandSize`

```js
{
	type: 'pick-up',
	pond: 12, // remaining pond size (number), not an array
}
```

### Informational (still reply)

| `type`           | Payload highlights                                      |
| ---------------- | ------------------------------------------------------- |
| `hand-update`    | `askingPlayer`, `playerAsked`, `card`, `result`, `hand` |
| `go-fish-result` | `card` (array of one card drawn), `hand`                |
| `pick-up-result` | `card` (array of one card drawn), `hand`                |

`hand-update` is broadcast to every participant after an ask resolves. `result` is how many cards were taken (`0` on a miss).

## Return (participant → arena)

| Message   | Return shape         | Notes                                                                |
| --------- | -------------------- | -------------------------------------------------------------------- |
| `ask`     | `{ player, cardId }` | `player` = team index to ask; `cardId` = `id` of a card in your hand |
| `go-fish` | number               | Index into the current pond                                          |
| `pick-up` | number               | Index into the current pond                                          |
| other     | any (e.g. `null`)    | Required so the worker handshake completes                           |

Example ask reply:

```js
{ player: 1, cardId: 42 }
```

Example draw reply:

```js
0
```

## Invalid responses

| Situation                                                            | Arena behavior                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `ask` missing/invalid `player`, asking yourself, or unknown `cardId` | Turn skipped; next team asks (`Clockwise` from you)                       |
| Non-finite pond index on `go-fish` / `pick-up`                       | Treated as `0`                                                            |
| Pond index out of range                                              | Wrapped with modulo into `[0, pondLength)` (negative indices wrap upward) |
| Not enough cards for the opening deal                                | Match rejected: Did-Not-Start                                             |

There is no substitute ask: a bad ask simply loses the turn. Empty pond on a miss skips `go-fish` and only advances the turn.

## Configuration

| Setting                  | Effect                                          |
| ------------------------ | ----------------------------------------------- |
| `rules.startingPlayer`   | `Random` or `First in line` (team `0`)          |
| `rules.startingHandSize` | Cards dealt to each player at start             |
| `rules.minHandSize`      | After losses/books, draw until hand size ≥ this |
| `rules.nextPlayer`       | After a miss: `Asked` or `Clockwise`            |
| `deck.numberOfDecks`     | How many decks fill the pond                    |
| `deck.knights`           | Include knight rank (`rank === 11`)             |

## Local development

1. Keep this folder at `public/srcArena/Arena-Go-Fish/` in the main app repo.
2. On the Setups page, point the arena URL at `http://localhost:5173/srcArena/Arena-Go-Fish/` (trailing `/`).
3. Add at least two joinables (e.g. `participant-TEMP.js` twice on different teams, or a human interface from `properties.json`).
4. Run `deno task dev` and start the match from Setups.

| File                  | Purpose                         |
| --------------------- | ------------------------------- |
| `arena.js`            | Match logic                     |
| `properties.json`     | Limits, settings, replay path   |
| `participant-TEMP.js` | Smoke-test / random participant |
| `html/`               | Replay and human interface      |
