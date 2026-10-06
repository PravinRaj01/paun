# Gold Compass

Build a beautiful client-side Gold Investment & Trade Assistant dashboard. Include a country comparison watch list with local tax settings, and a trade analyzer accepting weight, purity, craftsman fees, and melting costs. Keep all state management in-memory or save data to browser LocalStorage. Do not enforce or require a backend database login.

So a beautiful, modern client-side Gold Investment & Trade Assistant dashboard using React, Tailwind CSS, and Lucide icons. 

Key Requirements:

1. Pure Client-Side Architecture: Do not include or enforce a backend database or Supabase login. All state management must live in-memory or save directly to the browser's LocalStorage.

2. Country Comparison Watchlist: Allow users to add/customize countries to observe. Each country profile should allow custom inputs for Local Currency Name, Exchange Rate to USD, Import Duty %, and local Tax/VAT %.

3. Advanced Trade Analyzer: An interactive calculator taking inputs for: Gold Weight (grams), Purity (Dropdown: 24K, 22K, 21K, 18K, 14K, 10K), Craftsman/Making Fees (flat or per gram), and Melting/Refining Costs.

4. Profitability Metrics: Calculate and display the "Jeweler's Premium" (markup percentage over global spot price), the exact "Net Gold Value", and a dynamic "Break-Even Price".

5. Spread & Arbitrage Tool: Compare the total acquisition cost of a specific trade across the watched countries to highlight the best place to buy or sell.

6. Settings & API Panel: Provide a settings modal where users can manually adjust the global USD Gold Spot Price per ounce, or optionally paste a free public API key to pull live data directly via client-side fetch, saving the configuration to LocalStorage.

Make the UI clean, professional, and financial-dashboard style with dark mode support.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/44dc248e-6e26-4392-914e-ba5094078dae).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
