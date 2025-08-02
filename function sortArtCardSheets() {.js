function sortArtCardSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ["Regular Art Cards", "Signed Art Cards"]; // sheets to sort

  sheets.forEach(function(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    var range = sheet.getDataRange();
    var values = range.getValues();

    if (values.length <= 1) return; // no data

    var header = values.shift(); // remove header row

    // Sort by Set (col 1) then Number (col 2)
    values.sort(function(a, b) {
      var setA = a[0].toString();
      var setB = b[0].toString();
      if (setA !== setB) {
        return setA.localeCompare(setB);
      }
      var numA = parseInt(a[1]) || 0;
      var numB = parseInt(b[1]) || 0;
      return numA - numB;
    });

    // Clear and rewrite sorted data
    sheet.clear();
    sheet.appendRow(header);
    sheet.getRange(2, 1, values.length, values[0].length).setValues(values);
  });
}
