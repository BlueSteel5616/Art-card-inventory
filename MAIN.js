// ================================
// MTG Art Card Inventory Script (Unified)
// ================================
// Features:
// - Fetch all art cards from Scryfall (TCGPlayer pricing)
// - Separate Regular and Signed sheets
// - Batch update prices for Regular cards
// - Import card lists (with prices) from Raw Import sheet
// - Gold-stamped cards auto-map to Signed sheet
// - Collection Summary auto-calculated
// - Menu: Parse Raw Import & Update Inventory

// ============================================================================
// Fetch Price via Scryfall (TCGPlayer)
// ============================================================================
function fetchPriceFromScryfall(cardID) {
  try {
    const url = "https://api.scryfall.com/cards/" + cardID;
    const response = UrlFetchApp.fetch(url);
    const data = JSON.parse(response.getContentText());

    return {
      low: parseFloat(data.prices.usd) || 0,
      avg: parseFloat(data.prices.usd) || 0,
      market: parseFloat(data.prices.usd) || 0
    };
  } catch (e) {
    return { low: 0, avg: 0, market: 0 };
  }
}

// ============================================================================
// Fetch Art Series Data & Initialize Sheets
// ============================================================================
function fetchArtSeriesWithPrices() {
  const apiBase = "https://api.scryfall.com/cards/search";
  const query = "layout:art-series";
  const params = "?q=" + encodeURIComponent(query) + "&order=released&dir=asc";

  let url = apiBase + params;
  let allCards = [];

  while (url) {
    const response = UrlFetchApp.fetch(url);
    const data = JSON.parse(response.getContentText());

    data.data.forEach(card => {
      allCards.push({
        id: card.id,
        set: card.set.toUpperCase(),
        number: parseInt(card.collector_number, 10) || 0,
        name: card.name,
        artist: card.artist || "Unknown",
        release: card.released_at,
        signed: false
      });
    });

    url = data.has_more ? data.next_page : null;
  }

  // Sort by set and number
  allCards.sort((a, b) => a.set.localeCompare(b.set) || a.number - b.number);

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Write Regular Art Cards sheet
  function writeRegularSheet(data) {
    let sheet = ss.getSheetByName("Regular Art Cards");
    if (!sheet) {
      sheet = ss.insertSheet("Regular Art Cards");
    } else {
      sheet.clear();
    }

    sheet.appendRow([
      "Set", "Collector Number", "Card Name", "Artist", "Release Date",
      "Signed/Regular", "Low Price", "Average Price", "Market Price",
      "Quantity Owned", "Total Value", "Scryfall ID"
    ]);

    if (data.length > 0) {
      sheet.getRange(2, 1, data.length, 6).setValues(
        data.map(d => [d.set, d.number, d.name, d.artist, d.release, "Regular"])
      );

      // Fill IDs
      sheet.getRange(2, 12, data.length, 1).setValues(
        data.map(d => [d.id])
      );

      // Total value formula
      for (let i = 2; i <= data.length + 1; i++) {
        sheet.getRange(i, 11).setFormula(`=IF(J${i}<>"" , H${i}*J${i} , 0)`);
      }
    }
  }

  writeRegularSheet(allCards);
  duplicateToSignedSheetNoPricing();
  updateCollectionSummary();
}

// ============================================================================
// Duplicate to Signed Sheet (No Pricing)
// ============================================================================
function duplicateToSignedSheetNoPricing() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const regularSheet = ss.getSheetByName("Regular Art Cards");
  if (!regularSheet) return;

  const data = regularSheet.getDataRange().getValues();
  if (data.length <= 1) return;

  const header = data[0];
  const rows = data.slice(1);

  const signedRows = rows.map(row => {
    let newRow = row.slice();
    newRow[5] = "Signed";
    newRow[6] = "";
    newRow[7] = "";
    newRow[8] = "";
    newRow[10] = "";
    return newRow;
  });

  let signedSheet = ss.getSheetByName("Signed Art Cards");
  if (!signedSheet) {
    signedSheet = ss.insertSheet("Signed Art Cards");
  } else {
    signedSheet.clear();
  }

  signedSheet.appendRow(header);
  signedSheet.getRange(2, 1, signedRows.length, signedRows[0].length).setValues(signedRows);
}

// ============================================================================
// Batch Price Update for Regular Cards
// ============================================================================
function updatePricesInBatches() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();

  let index = parseInt(props.getProperty('currentIndex') || "0");
  const sheet = ss.getSheetByName("Regular Art Cards");
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const BATCH_SIZE = 200;
  const startRow = 2 + index;
  const endRow = Math.min(startRow + BATCH_SIZE - 1, lastRow);

  const ids = sheet.getRange(startRow, 12, endRow - startRow + 1, 1).getValues().map(r => r[0]);

  for (let i = 0; i < ids.length; i++) {
    const cardID = ids[i];
    const prices = fetchPriceFromScryfall(cardID);
    const row = startRow + i;

    sheet.getRange(row, 7).setValue(prices.low);
    sheet.getRange(row, 8).setValue(prices.avg);
    sheet.getRange(row, 9).setValue(prices.market);
  }

  if (endRow < lastRow) {
    props.setProperty('currentIndex', (index + BATCH_SIZE).toString());
  } else {
    props.deleteAllProperties();
    updateCollectionSummary();
  }
}

// ============================================================================
// Auto Trigger for Batch Updates
// ============================================================================
function startBatchTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "updatePricesInBatches") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("updatePricesInBatches")
    .timeBased()
    .everyMinutes(5)
    .create();
}

// ============================================================================
// Parse Raw Import (Quantities + Prices)
// ============================================================================
function parsePriceListToInventory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Raw Import sheet
  let rawSheet = ss.getSheetByName("Raw Import");
  if (!rawSheet) {
    rawSheet = ss.insertSheet("Raw Import");
    rawSheet.appendRow(["Paste your price list here"]);
    SpreadsheetApp.getUi().alert("Created 'Raw Import'. Paste list and rerun.");
    return;
  }

  const rawText = rawSheet.getDataRange().getValues().flat().join("\n");
  const lines = rawText.split("\n").filter(l => l.includes("Art Card"));

  // Prepare Inventory Import sheet
  let importSheet = ss.getSheetByName("Inventory Import");
  if (!importSheet) {
    importSheet = ss.insertSheet("Inventory Import");
  } else {
    importSheet.clear();
  }
  importSheet.appendRow(["Set", "Collector Number", "Quantity", "Price"]);

  // Reference data from Regular Art Cards
  const regularSheet = ss.getSheetByName("Regular Art Cards");
  if (!regularSheet) {
    SpreadsheetApp.getUi().alert("Run fetchArtSeriesWithPrices first.");
    return;
  }
  const regularData = regularSheet.getDataRange().getValues();

  for (let line of lines) {
    const quantityMatch = line.match(/^(\d+)/);
    const quantity = quantityMatch ? parseInt(quantityMatch[1], 10) : 1;

    const nameMatch = line.match(/^\d+\s(.+?)\sArt Card/);
    const cardName = nameMatch ? nameMatch[1] : "";

    const priceMatch = line.match(/\$([\d.]+)/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : "";

    const isGoldStamped = line.includes("Gold-Stamped");

    const cardRow = regularData.find(row => row[2] === cardName);
    if (!cardRow) continue;

    const setCode = cardRow[0];
    const cardNumber = cardRow[1];

    if (isGoldStamped) {
      // Update Signed Art Cards directly
      const signedSheet = ss.getSheetByName("Signed Art Cards");
      if (signedSheet) {
        const finder = signedSheet.createTextFinder(cardName).findNext();
        if (finder) {
          signedSheet.getRange(finder.getRow(), 10).setValue(quantity);
        }
      }
    } else {
      // Add to Inventory Import
      importSheet.appendRow([setCode, cardNumber, quantity, price]);
    }
  }

  SpreadsheetApp.getUi().alert("Import processed: Regular → Inventory Import, Signed → Signed Art Cards.");
}

// ============================================================================
// Update Quantities + Prices from Inventory Import
// ============================================================================
function updateQuantitiesFromImport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var importSheet = ss.getSheetByName("Inventory Import");
  if (!importSheet) {
    SpreadsheetApp.getUi().alert("No 'Inventory Import' sheet found.");
    return;
  }

  var data = importSheet.getDataRange().getValues();
  if (data.length <= 1) {
    SpreadsheetApp.getUi().alert("No data found in 'Inventory Import'.");
    return;
  }

  // Grab headers
  var header = data.shift().map(String);

  // Synonym map for flexible header detection
  var headerMap = {
    code: ["Code", "Set Code", "Set", "Code Abbr"],
    number: ["Number", "Collector Number", "#"],
    signature: ["Signature", "Signed", "Gold-Stamped Signature"],
    price: ["Market Price", "Price", "TCG Market Price"],
    quantity: ["Quantity", "Qty", "Count", "Amount"]
  };

  // Helper to find column index by synonyms
  function findIndex(synonyms) {
    for (var i = 0; i < header.length; i++) {
      if (synonyms.some(name => header[i].toLowerCase().includes(name.toLowerCase()))) {
        return i;
      }
    }
    return -1;
  }

  var codeIdx = findIndex(headerMap.code);
  var numIdx = findIndex(headerMap.number);
  var sigIdx = findIndex(headerMap.signature);
  var priceIdx = findIndex(headerMap.price);
  var qtyIdx = findIndex(headerMap.quantity); // optional

  // Validate required columns
  if (codeIdx === -1 || numIdx === -1 || sigIdx === -1 || priceIdx === -1) {
    SpreadsheetApp.getUi().alert(
      "Could not detect required columns (need Code, Number, Signature, Market Price)."
    );
    return;
  }

  var regularSheet = ss.getSheetByName("Regular Art Cards");
  var signedSheet = ss.getSheetByName("Signed Art Cards");
  if (!regularSheet || !signedSheet) {
    SpreadsheetApp.getUi().alert("Missing 'Regular Art Cards' or 'Signed Art Cards' sheet.");
    return;
  }

  var regData = regularSheet.getDataRange().getValues();
  var signedData = signedSheet.getDataRange().getValues();

  // Map rows by Set Code + Number
  var regMap = {};
  for (var i = 1; i < regData.length; i++) {
    regMap[regData[i][0] + "-" + regData[i][1]] = i + 1;
  }
  var signedMap = {};
  for (var j = 1; j < signedData.length; j++) {
    signedMap[signedData[j][0] + "-" + signedData[j][1]] = j + 1;
  }

  var updatedCount = 0;

  // Process each imported row
  data.forEach(function(row) {
    var setCode = row[codeIdx];
    var number = row[numIdx];
    var signed = row[sigIdx] === "S" || row[sigIdx].toString().toLowerCase().includes("gold");
    var price = parseFloat(row[priceIdx].toString().replace("$", "").trim()) || 0;
    var qty = qtyIdx !== -1 ? parseInt(row[qtyIdx]) || 0 : 0;

    if (!setCode || !number) return;

    var key = setCode + "-" + number;
    if (signed && signedMap[key]) {
      if (price) signedSheet.getRange(signedMap[key], 5).setValue(price);
      if (qty) signedSheet.getRange(signedMap[key], 10).setValue(qty);
      updatedCount++;
    } else if (!signed && regMap[key]) {
      if (price) regularSheet.getRange(regMap[key], 5).setValue(price);
      if (qty) regularSheet.getRange(regMap[key], 10).setValue(qty);
      updatedCount++;
    }
  });

  SpreadsheetApp.getUi().alert(updatedCount + " cards updated successfully.");
}

// ============================================================================
// Collection Summary (Totals + Top 5)
// ============================================================================
function updateCollectionSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const regularSheet = ss.getSheetByName("Regular Art Cards");
  const signedSheet = ss.getSheetByName("Signed Art Cards");
  let summarySheet = ss.getSheetByName("Collection Summary");

  if (!summarySheet) {
    summarySheet = ss.insertSheet("Collection Summary");
  } else {
    summarySheet.clear();
  }

  function getData(sheet) {
    const values = sheet.getDataRange().getValues();
    values.shift();
    return values.map(row => ({
      set: row[0],
      signed: row[5] === "Signed",
      quantity: Number(row[9]) || 0,
      totalValue: Number(row[10]) || 0
    }));
  }

  const allData = [...getData(regularSheet), ...getData(signedSheet)];
  const totalsBySet = {};
  allData.forEach(row => {
    if (!totalsBySet[row.set]) totalsBySet[row.set] = { quantity: 0, value: 0 };
    totalsBySet[row.set].quantity += row.quantity;
    if (!row.signed) totalsBySet[row.set].value += row.totalValue;
  });

  summarySheet.appendRow(["Set", "Total Quantity Owned", "Total Market Value"]);
  for (const [set, totals] of Object.entries(totalsBySet)) {
    summarySheet.appendRow([set, totals.quantity, totals.value]);
  }

  const totalQuantity = Object.values(totalsBySet).reduce((sum, t) => sum + t.quantity, 0);
  const totalValue = Object.values(totalsBySet).reduce((sum, t) => sum + t.value, 0);
  summarySheet.appendRow(["Grand Total", totalQuantity, totalValue]);
}

// ============================================================================
// Menu Setup
// ============================================================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("Inventory Tools")
    .addItem("Parse Raw Import", "parsePriceListToInventory")
    .addItem("Update Inventory Quantities", "updateQuantitiesFromImport")
    .addToUi();
}
    function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("Inventory Tools")
    .addItem("Parse Raw Import / TCG CSV", "parsePriceListToInventory")
    .addItem("Update Inventory Quantities", "updateQuantitiesFromImport")
    .addItem("Fetch Art Cards from Scryfall", "fetchArtSeriesWithPrices")
    .addItem("Generate Weekly Leaderboard", "updateCollectionSummary")
    .addItem("Sort Art Card Sheets", "sortArtCardSheets") // NEW
    .addToUi();

}