function uploadCSVPromptAuto() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert("Step 1: Prompt opened");

    var response = ui.prompt(
      "Paste CSV Data",
      "Paste your CSV export from TCGplayer or MTGStocks (with or without Quantity):",
      ui.ButtonSet.OK_CANCEL
    );

    if (response.getSelectedButton() == ui.Button.OK) {
      ui.alert("Step 2: CSV captured");

      var csvString = response.getResponseText();
      if (!csvString || csvString.trim() === "") {
        ui.alert("No CSV data detected — paste your CSV and try again.");
        return;
      }

      // Show first few characters of the CSV so we know it captured correctly
      ui.alert("CSV Preview (first 200 chars):\n" + csvString.substring(0, 200));

      importCSVtoSheetAndUpdate(csvString, "Inventory Import");

      ui.alert("Step 3: Import finished — check if data appears in Inventory Import sheet");
    } else {
      ui.alert("Prompt canceled.");
    }
  } catch (err) {
    SpreadsheetApp.getUi().alert("Upload Error: " + err.message + "\n(See Executions tab for stack trace)");
  }
}
