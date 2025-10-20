# 060826
A minimalist wedding invitation and details site for Mark and Patricia

## Google Apps Script

The RSVP form submits to a Google Apps Script web app. A reference
implementation lives in `resources/rsvp-google-apps-script.gs`. Copy the
contents into the script editor that is bound to your spreadsheet, update the
`SHEET_ID` constant if your sheet lives at a different URL, and deploy it as a
web app. The script expects a `GuestList` tab that holds the master invitation
list and a `FormResponses` tab that collects the raw submissions before syncing
updates back to the guest list.
