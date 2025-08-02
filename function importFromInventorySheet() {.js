function importFromInventorySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rawSheet = ss.getSheetByName("Inventory Import");
  if (!rawSheet) {
    SpreadsheetApp.getUi().alert("No 'Inventory Import' sheet found. Create it and paste CSV there.");
    return;
  }

  SpreadsheetApp.getUi().alert("Step 1: Reading Inventory Import data");
  updateQuantitiesFromImport();
  SpreadsheetApp.getUi().alert("Step 2: Update finished — check Regular/Signed sheets.");