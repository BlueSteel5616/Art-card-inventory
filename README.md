# MTG Art Card Inventory – Function Reference

This document provides a detailed description of all functions included in the MTG Art Card Inventory project, explaining their roles and logic within the system.

---

## Google Apps Script Functions

These scripts run inside Google Sheets and handle data import, sorting, pricing, and inventory management.

---

### MAIN.js

#### `fetchPriceFromScryfall(cardID)`
- Calls the Scryfall API to retrieve pricing information for a given card ID.
- Returns low, average, and market price values (defaulting to 0 if unavailable).
- Used internally by batch update functions to fill price columns.

#### `fetchArtSeriesWithPrices()`
- Queries Scryfall for all cards with the `art-series` layout.
- Collects metadata: set code, collector number, card name, artist, release date, and ID.
- Populates the **Regular Art Cards** sheet with this data, sorted by set and number.
- Calls `duplicateToSignedSheetNoPricing()` to generate a **Signed Art Cards** sheet without pricing.
- Calls `updateCollectionSummary()` after population.

#### `duplicateToSignedSheetNoPricing()`
- Copies rows from **Regular Art Cards** to **Signed Art Cards**.
- Marks them as “Signed” but leaves price and value fields blank.
- Ensures both sheets maintain parallel structure.

#### `updatePricesInBatches()`
- Performs incremental price updates for **Regular Art Cards**.
- Processes cards in chunks of 200 to avoid API throttling.
- Saves progress using Script Properties to continue across multiple executions.
- Updates low, average, and market price columns in the sheet.
- Calls `updateCollectionSummary()` after completing all updates.

#### `startBatchTrigger()`
- Deletes any existing triggers for `updatePricesInBatches`.
- Creates a new time-based trigger to run every 5 minutes automatically.
- Ensures continuous batch updates without manual intervention.

#### `parsePriceListToInventory()`
- Reads raw CSV or text data from the **Raw Import** sheet.
- Extracts quantity, card name, set code, and price data.
- Differentiates between **Regular** and **Signed (Gold-Stamped)** cards.
- Populates the **Inventory Import** sheet with Regular data.
- Directly updates **Signed Art Cards** for signed entries.

#### `updateQuantitiesFromImport()`
- Reads the **Inventory Import** sheet.
- Maps imported data to **Regular** and **Signed Art Card** sheets using set code and collector number.
- Updates **Quantity** and **Market Price** fields accordingly.
- Alerts how many cards were successfully updated.

#### `updateCollectionSummary()`
- Aggregates totals from **Regular** and **Signed** sheets.
- Groups data by set code, summing total quantities and total market values.
- Generates a **Collection Summary** sheet with per-set totals and a grand total.

#### `onOpen()`
- Creates a custom menu called **Inventory Tools** in the Google Sheets UI.
- Provides menu items to trigger key functions:
  - Parse Raw Import
  - Update Inventory Quantities
  - Fetch Art Cards from Scryfall
  - Generate Weekly Leaderboard (Collection Summary)
  - Sort Art Card Sheets

---

### function importFromInventorySheet() {.js}

#### `importFromInventorySheet()`
- Ensures the **Inventory Import** sheet exists.
- Triggers `updateQuantitiesFromImport()` to process and merge inventory data into the main sheets.
- Provides alerts for missing sheets or completion status.

---

### function myFunction() {.js}

#### `startBatchTrigger()` (duplicate of MAIN.js)
- Same role as in MAIN.js: sets up automatic triggers for `updatePricesInBatches`.
- Included here likely as a standalone utility script for trigger creation.

---

### function sortArtCardSheets() {.js}

#### `sortArtCardSheets()`
- Sorts both **Regular Art Cards** and **Signed Art Cards** sheets.
- Sort order:
  1. Set code (alphabetically).
  2. Collector number (numerically).
- Preserves header row and rewrites sorted data back into the sheet.

---

### function uploadCSVPromptAuto() {.js}

#### `uploadCSVPromptAuto()`
- Opens a UI prompt allowing the user to paste CSV data directly into the script (bypassing manual sheet entry).
- Previews the first 200 characters of pasted CSV for validation.
- Imports data into the **Inventory Import** sheet and triggers an update.
- Handles user cancellation and input errors gracefully.

---

## Python Script Functions (updater.py)

This script operates outside Google Sheets and manages more robust, scheduled updates, weekly comparisons, and archival.

---

### Configuration and Setup

#### `CONFIG`
- Holds configuration constants:
  - API endpoints (Scryfall, JustTCG).
  - Spreadsheet name.
  - Daily update limit and batch delays.
  - Log file location.

---

### Utility Functions

#### `safe_float(value)`
- Converts strings (like `$1.25`) into floats safely.
- Returns 0 if parsing fails.

---

### Sheet Validation

#### `validate_or_refresh_sheets()`
- Checks if **Regular** and **Signed** sheets have expected headers or are empty.
- If invalid, calls `get_scryfall_art_cards()` and `populate_sheets()` to refresh with Scryfall data.

---

### Scryfall Data Handling

#### `get_scryfall_art_cards()`
- Downloads bulk MTG card data from Scryfall.
- Filters cards with `art_series` layout.
- Returns structured metadata for each art card.

#### `populate_sheets(cards)`
- Clears both **Regular** and **Signed** sheets.
- Fills them with header rows and card metadata (set, number, name, artist).

---

### Price Fetching (JustTCG API)

#### `fetch_justtcg_price(card_name, signed=False)`
- Queries the JustTCG API for market pricing of a card.
- Adds "Signed" to query if `signed=True`.
- Returns the market price (0 if unavailable or on API error).

---

### Incremental Updates

#### `update_incremental_prices()`
- Updates card prices incrementally (up to daily limit).
- Compares **Last Fetched** date to ensure 30-day refresh cycle.
- Logs updated and skipped counts.
- Updates **Last Fetched** column with current date after update.

---

### Weekly Functions

#### `archive_weekly_prices()`
- Copies current **Market Price** into **Last Week Price** column.
- Resets **Weekly Change** column to `0` for fresh comparisons.

#### `calculate_weekly_change()`
- Computes `Weekly Change = Current Price – Last Week Price` for each card.
- Updates the **Weekly Change** column in both sheets.

---

### Status Updates

#### `update_status_sheet(updated, updated_percent, skipped, skipped_percent)`
- Updates or creates a **Status** sheet summarizing the last run:
  - Last update timestamp.
  - Count and percentage of updated vs skipped cards.

---

### Main Entry Point

#### `main()`
- Validates sheets and refreshes them if needed.
- Runs incremental price updates.
- Executes weekly snapshot or change calculation depending on the day.
- Updates the Status sheet.
- Logs completion details.
