# 060826
A minimalist wedding invitation and details site for Mark and Patricia

## Google Apps Script

The RSVP form submits to a Google Apps Script web app. A reference
implementation lives in `resources/rsvp-google-apps-script.gs`. Copy the
contents into the script editor that is bound to your spreadsheet, update the
`SHEET_ID` constant if your sheet lives at a different URL, and deploy it as a
web app.

### Spreadsheet expectations

* `Roster` tab — contains one row per invitation with the following headers:
  `FamilyID`, `LeadName`, `LeadEmail`, `Members`, `UniqueCode`, `Submitted`,
  `SubmittedAt`. Members can be separated by semicolons or new lines. The
  `UniqueCode` column holds the family-specific code that guests will type to
  access their RSVP.
* `Responses` tab — receives one row per attendee per submission with headers:
  `Timestamp`, `FamilyID`, `PersonName`, `Attending`, `SubmittedBy`, `Notes`.

Guests land on the public site, enter their `UniqueCode`, and are redirected to
the RSVP form with their family information pre-filled. They can revisit with
the same code to review or update their responses; the latest answers will be
pulled from the spreadsheet on each visit.
