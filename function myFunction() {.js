function myFunction() {
  function startBatchTrigger() {
  // Remove existing triggers for clean setup
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "updatePricesInBatches") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create 5-minute trigger
  ScriptApp.newTrigger("updatePricesInBatches")
    .timeBased()
    .everyMinutes(5)
    .create();
}