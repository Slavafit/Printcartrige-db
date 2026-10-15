# Task 029 — Brother acquisition and processing from the desktop UI

Status: implemented and validated on `feature/electron-collector-runtime`.

## Goal

Run the existing Brother España workflow end to end from PrinterDB: acquire a conservative batch of official supply pages, retain the HTML, parse the complete saved cache, rebuild the audit and prepare an explicit import result.

## Implementation

- **Recopilar y procesar** launches an installed Microsoft Edge, falling back to Google Chrome, with an isolated temporary browser profile.
- The acquisition boundary accepts only HTTPS supply URLs on `store.brother.es` from the committed `brother-candidates.json` list.
- Each run requests at most 20 previously unsaved pages with at least five seconds between requests.
- HTML is accepted only after HTTP 200 and the explicit `#related-products` section are present.
- HTTP 403/429 and access challenges stop the run without bypass attempts. Missing compatibility sections go to the review folder and never become input evidence.
- Saved HTML, collection history, review pages, checkpoints, reports, rebuilt data and import packages live below `%APPDATA%\printcartridge-db\collector-workspace`.
- Acquisition is followed by the existing strict parser, model repair, audit preservation and multi-source package preparation.
- Database import remains a separate explicit button and still begins with a dry run.

## Packaging

The portable Electron build includes `playwright-core`, the acquisition script, the fixed candidate list, parser helpers and the saved reverse-verification seed. It does not bundle another Chromium binary; Edge or Chrome must already be installed.

## Limitations

This workflow updates only the fixed known supply candidate list. It does not discover arbitrary new Brother products and does not refresh reverse printer-page verification. New relationships without saved reverse evidence remain `candidate` and are not promoted to `official_verified`. Source access can still be denied by Brother; the application reports that condition and stops.
