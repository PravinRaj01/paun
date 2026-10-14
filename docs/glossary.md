# Glossary: one word for one idea

Every word a shopper reads comes from `src/locales/en.json` and `src/locales/ms.json`. This file says which
word to use for each idea, in both languages, and which words not to use. `src/locales/copy.test.ts` fails when a
locale string uses a word from the "Avoid" column, so the list below is the single source of truth.

Trade words (upah, susut, harga jual / beli, kadar beli balik) are Malay shop language. They stay as they are in
English text and are explained once in the guide; they are not machine-translated.

The Malay column is a first draft for the owner to approve. Change a row here and in the locale files together.

## Terms

| Idea | English | Bahasa Melayu | Avoid (English) | Avoid (Malay) |
|---|---|---|---|---|
| What the jeweller charges for making the piece | upah (making charge) | upah | making fee, workmanship | upah tukang |
| What the shop takes off when it buys gold back, as a % of its selling rate | susut | susut | (deduction on its own) | susut nilai (means depreciation) |
| What the shop pays per gram when you sell | buy-back rate | kadar beli balik | | kadar beli |
| What the shop charges per gram | selling rate | kadar jual | | |
| Gold swapped for credit or new jewellery | trade-in | tukar tambah | | (tukar alone: it also means exchange) |
| Money exchange | exchange rate | kadar tukaran | | |
| How much the shop adds on top of the gold's value | shop mark-up | tokokan kedai | premium, markup | margin kedai, premium kedai |
| The gold's own value with no mark-up | raw gold | emas mentah | raw spot, spot price | harga mentah, harga spot |
| What a shop usually charges | shop price | harga kedai | retail price | |
| The world price of gold | world gold price | harga emas dunia | global spot | harga spot |
| What you lose by buying and selling back at one shop | buy and sell back costs | beli dan jual semula merugikan | spread, break-even | |
| Purity | purity | ketulenan | | |
| Your saved pieces | My gold (the page), vault (a saved piece) | Emas saya, peti simpanan | | |
| The unit of about 8 g (Tamil) | paun | paun | | |

## Words that are never used in the app

arbitrage, spread, break-even, premium (as a label), spot (as a label), "fair price", "true price". The app
checks whether a quote adds up; it never judges a price as fair (see PLAN.md section 6).

## How to add a word

1. Add a row above with both languages and any word it replaces.
2. Put the strings in `en.json` and `ms.json`; components never carry text of their own.
3. If a word must never appear, add it to the `AVOID` list in `src/locales/copy.test.ts`.
