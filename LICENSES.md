# Licencje komponentów

Kod: **MIT**.

## Usługi i obrazy kontenerów

| Komponent | Zastosowanie | Licencja |
|---|---|---|
| [Maigret](https://github.com/soxoj/maigret) 0.6.6 | wyszukiwanie kont po nicku (osint-worker) | MIT |
| [PostgreSQL](https://www.postgresql.org/) 16 | baza danych | PostgreSQL License |
| [Node.js](https://nodejs.org/) 22 | środowisko API | MIT |
| [Python](https://www.python.org/) 3.12 | środowisko workera | PSF License |
| [nginx](https://nginx.org/) 1.27 | serwowanie frontendu, reverse proxy | BSD-2-Clause |
| [Ollama](https://github.com/ollama/ollama) (opcjonalnie) | lokalne modele AI | MIT |

## Biblioteki – API (`apps/api`)

| Biblioteka | Licencja |
|---|---|
| fastify, @fastify/cors | MIT |
| pg (node-postgres) | MIT |
| cheerio | MIT |
| @noble/hashes (keccak-256 dla EIP-55) | MIT |
| zod | MIT |
| typescript, tsx, vitest (dev) | Apache-2.0 / MIT / MIT |

## Biblioteki – frontend (`apps/web`)

| Biblioteka | Licencja |
|---|---|
| react, react-dom | MIT |
| vite, @vitejs/plugin-react (dev) | MIT |

## Biblioteki – worker (`services/osint-worker`)

| Biblioteka | Licencja |
|---|---|
| maigret (oraz jej zależności: aiohttp, requests, socid-extractor…) | MIT / Apache-2.0 |
| fastapi | MIT |
| uvicorn | BSD-3-Clause |

## Zewnętrzne API (tylko tryb live, możliwy self-hosting)

| Usługa | Oprogramowanie | Licencja oprogramowania |
|---|---|---|
| Blockscout API v2 (Ethereum) | [blockscout/blockscout](https://github.com/blockscout/blockscout) | GPL-3.0 (usługa zewnętrzna, nie dołączana do kodu) |
| mempool.space API (Bitcoin) | [mempool/mempool](https://github.com/mempool/mempool) | AGPL-3.0 (usługa zewnętrzna, nie dołączana do kodu) |
| SearXNG (opcjonalnie) | [searxng/searxng](https://github.com/searxng/searxng) | AGPL-3.0 (usługa zewnętrzna, nie dołączana do kodu) |

Rejestr etykiet (`apps/api/data/labels`) zawiera wyłącznie publicznie ogłoszone adresy usług (giełdy, kontrakty, zbiórki), opisane polem `source`.
