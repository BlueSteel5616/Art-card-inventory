import requests
import gspread
from google.oauth2.service_account import Credentials
from datetime import datetime, timedelta, timezone
import time
import logging

# ---------------- CONFIGURATION ----------------
CONFIG = {
    "SCRYFALL_BULK_URL": "https://api.scryfall.com/bulk-data/default-cards",
    "JUSTTCG_API_KEY": "tcg_9dbc93a5702845df81b03785e2a7b382",
    "SPREADSHEET_NAME": "art cards 2.0",
    "DAILY_LIMIT": 16,
    "BATCH_DELAY": 1,
    "LOG_FILE": "price_update.log"
}

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(CONFIG["LOG_FILE"]),
        logging.StreamHandler()
    ]
)

# ---------------- SAFE FLOAT ----------------
def safe_float(value):
    try:
        return float(str(value).replace('$', '').strip())
    except:
        return 0

# ---------------- GOOGLE SHEETS AUTH ----------------
SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
creds = Credentials.from_service_account_file("credentials.json", scopes=SCOPES)
client = gspread.authorize(creds)

regular_sheet = client.open(CONFIG["SPREADSHEET_NAME"]).worksheet("Regular Art Cards")
signed_sheet = client.open(CONFIG["SPREADSHEET_NAME"]).worksheet("Signed Art Cards")

# ---------------- EXPECTED HEADERS ----------------
EXPECTED_HEADERS = [
    "Set", "Number", "Name", "Artist",
    "Market Price", "Last Week Price", "Weekly Change", "Last Fetched"
]

def validate_or_refresh_sheets():
    """
    Check headers and data; refresh from Scryfall if invalid or empty.
    """
    def check_sheet(sheet_name):
        sheet = client.open(CONFIG["SPREADSHEET_NAME"]).worksheet(sheet_name)
        data = sheet.get_all_values()

        if not data or data[0] != EXPECTED_HEADERS:
            logging.warning(f"{sheet_name} headers invalid or sheet empty — refreshing from Scryfall...")
            cards = get_scryfall_art_cards()
            populate_sheets(cards)
            return True
        return False

    refreshed_regular = check_sheet("Regular Art Cards")
    refreshed_signed = check_sheet("Signed Art Cards")
    return refreshed_regular or refreshed_signed

# ---------------- SCRYFALL FETCH ----------------
def get_scryfall_art_cards():
    try:
        meta = requests.get(CONFIG["SCRYFALL_BULK_URL"]).json()
        bulk_url = meta.get("download_uri")
        if not bulk_url:
            raise ValueError("Could not retrieve bulk data URL from Scryfall API")

        all_cards = requests.get(bulk_url).json()
        art_cards = [c for c in all_cards if c.get("layout") == "art_series"]

        return [
            {
                "name": c["name"],
                "set": c["set"].upper(),
                "number": c["collector_number"],
                "artist": c.get("artist", "Unknown")
            }
            for c in art_cards
        ]
    except Exception as e:
        logging.error(f"Error fetching Scryfall art cards: {e}")
        return []

# ---------------- JUSTTCG PRICE FETCH ----------------
def fetch_justtcg_price(card_name, signed=False):
    query = card_name + " Signed" if signed else card_name
    url = "https://api.justtcg.com/pricing/search"
    headers = {"Authorization": f"Bearer {CONFIG['JUSTTCG_API_KEY']}"}
    params = {"q": query}

    try:
        resp = requests.get(url, headers=headers, params=params)
        if resp.status_code != 200:
            logging.warning(f"API returned {resp.status_code} for {query}")
            return 0

        data = resp.json()
        if data and "results" in data and len(data["results"]) > 0:
            return data["results"][0].get("marketPrice", 0)
        return 0
    except Exception as e:
        logging.error(f"Error fetching price for {query}: {e}")
        return 0

# ---------------- INITIAL SHEET POPULATION ----------------
def populate_sheets(cards):
    header = EXPECTED_HEADERS

    reg_rows = [header]
    for card in cards:
        reg_rows.append([card["set"], card["number"], card["name"], card["artist"], "", "", "", ""])

    regular_sheet.clear()
    regular_sheet.update("A1", reg_rows)

    signed_rows = [header]
    for card in cards:
        signed_rows.append([card["set"], card["number"], card["name"], card["artist"], "", "", "", ""])

    signed_sheet.clear()
    signed_sheet.update("A1", signed_rows)

# ---------------- INCREMENTAL UPDATE ----------------
def update_incremental_prices():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    total_updated = 0
    total_skipped = 0

    def process_sheet(sheet, signed=False):
        nonlocal total_updated, total_skipped
        data = sheet.get_all_values()
        header = data[0]
        name_idx = header.index("Name")
        price_idx = header.index("Market Price")
        last_fetch_idx = header.index("Last Fetched")

        updated_count = 0
        for i in range(1, len(data)):
            if updated_count >= CONFIG["DAILY_LIMIT"]:
                break

            row = data[i]
            last_fetched = row[last_fetch_idx]
            should_update = False

            if not last_fetched:
                should_update = True
            else:
                try:
                    last_date = datetime.strptime(last_fetched, "%Y-%m-%d")
                    if datetime.now(timezone.utc) - last_date.replace(tzinfo=timezone.utc) > timedelta(days=30):
                        should_update = True
                except:
                    should_update = True

            if should_update:
                card_name = row[name_idx]
                price = fetch_justtcg_price(card_name, signed=signed)
                sheet.update_cell(i + 1, price_idx + 1, price)
                sheet.update_cell(i + 1, last_fetch_idx + 1, today)
                updated_count += 1
                total_updated += 1
                logging.info(f"Updated {card_name} ({'Signed' if signed else 'Regular'}) to {price}")
                time.sleep(CONFIG["BATCH_DELAY"])
            else:
                total_skipped += 1

    process_sheet(regular_sheet, signed=False)
    process_sheet(signed_sheet, signed=True)

    total_processed = total_updated + total_skipped
    updated_percent = (total_updated / total_processed * 100) if total_processed else 0
    skipped_percent = (total_skipped / total_processed * 100) if total_processed else 0

    logging.info(f"Total cards updated this run: {total_updated} ({updated_percent:.2f}%)")
    logging.info(f"Total cards skipped (up-to-date): {total_skipped} ({skipped_percent:.2f}%)")

    return total_updated, updated_percent, total_skipped, skipped_percent

# ---------------- WEEKLY SNAPSHOT ----------------
def archive_weekly_prices():
    def archive_sheet(sheet):
        data = sheet.get_all_values()
        header = data[0]
        price_idx = header.index("Market Price")
        last_week_idx = header.index("Last Week Price")
        change_idx = header.index("Weekly Change")

        for i in range(1, len(data)):
            current_price = safe_float(data[i][price_idx])
            sheet.update_cell(i + 1, last_week_idx + 1, current_price)
            sheet.update_cell(i + 1, change_idx + 1, 0)

    archive_sheet(regular_sheet)
    archive_sheet(signed_sheet)

# ---------------- WEEKLY CHANGE CALCULATION ----------------
def calculate_weekly_change():
    def calc_sheet(sheet):
        data = sheet.get_all_values()
        header = data[0]
        price_idx = header.index("Market Price")
        last_week_idx = header.index("Last Week Price")
        change_idx = header.index("Weekly Change")

        for i in range(1, len(data)):
            current_price = safe_float(data[i][price_idx])
            last_week_price = safe_float(data[i][last_week_idx])
            change = current_price - last_week_price
            sheet.update_cell(i + 1, change_idx + 1, change)

    calc_sheet(regular_sheet)
    calc_sheet(signed_sheet)

# ---------------- STATUS SHEET ----------------
def update_status_sheet(updated, updated_percent, skipped, skipped_percent):
    status_sheet = None
    try:
        status_sheet = client.open(CONFIG["SPREADSHEET_NAME"]).worksheet("Status")
    except gspread.WorksheetNotFound:
        status_sheet = client.open(CONFIG["SPREADSHEET_NAME"]).add_worksheet("Status", rows="10", cols="2")

    status_sheet.clear()
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    status_sheet.append_row(["Last Updated", now_str])
    status_sheet.append_row(["Cards Updated", f"{updated} ({updated_percent:.2f}%)"])
    status_sheet.append_row(["Cards Skipped", f"{skipped} ({skipped_percent:.2f}%)"])

# ---------------- MAIN ----------------
def main():
    # Validate headers and refresh if needed
    refresh_triggered = validate_or_refresh_sheets()
    if refresh_triggered:
        logging.info("Sheets refreshed with latest Scryfall data.")

    # Update prices
    updated, updated_percent, skipped, skipped_percent = update_incremental_prices()

    # Weekly logic
    if datetime.now(timezone.utc).weekday() == 6:
        archive_weekly_prices()
    else:
        calculate_weekly_change()

    # Update Status sheet
    update_status_sheet(updated, updated_percent, skipped, skipped_percent)

    logging.info("Incremental update complete.")

if __name__ == "__main__":
    main()
