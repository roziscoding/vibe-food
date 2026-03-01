# Functionality

## Product behavior

Vibe Food is a meal tracker centered on local ownership of food data. Users define ingredients once, reuse them in meals, track daily totals, and optionally sync that state between devices.

## Home dashboard

Route: `/`

The dashboard:

- loads meals from local storage
- groups them by the currently selected local day
- shows calorie progress against the configured goal
- shows aggregate protein, carbs, and fat totals
- allows moving backward and forward through days
- provides a quick "Log meal" entry point

## Meals

Route: `/meals`

The meals area supports two main creation modes:

- manual entry of calories and macros
- ingredient-based composition using saved ingredients and quantities

It also supports:

- date-targeted meal creation
- AI-assisted import from a free-form meal description
- manual JSON import into the meal editor
- editing existing meals

### AI meal import

The meal import flow:

1. reads the locally configured AI provider and API key
2. sends the meal description and current ingredient inventory to the selected provider
3. receives structured JSON describing matched ingredients and possible new ingredients
4. stores that JSON in session storage as an import draft
5. routes into `/meals/import` for review before saving

If the AI response includes new ingredients, they are staged in the import editor before being committed to the main ingredient list.

### Meal editor route

Route handler: `app/pages/meals/[id].vue`

This route behaves as:

- `/meals/new`: blank editor
- `/meals/import`: import-review editor
- `/meals/<meal-id>`: existing meal editor

That route also owns:

- date/time handling for saved meals
- staged ingredient editing during import
- conversion between composed ingredients and the final meal snapshot

## Ingredients

Route: `/ingredients`

The ingredients page supports:

- create, edit, and delete ingredient records
- storage of per-portion and per-unit nutrition values
- export of a lightweight ingredient list JSON
- import/review flows for external ingredient payloads
- AI extraction from nutrition label images

### AI ingredient import

The image import flow:

1. accepts a nutrition label image in the browser
2. sends it directly to the configured AI provider
3. expects structured JSON back with product name, serving size, calories, and macros
4. lets the user review the extracted values before saving

## Settings

Route: `/settings`

The settings page covers four operational areas.

### Goal management

- daily calorie goal
- protein goal
- carbs goal
- fat goal
- a recommendation helper for generating target values from user inputs

### AI integration

- select provider (`openai` or `anthropic`)
- set or replace the API key
- test the API key
- unlock and migrate legacy AI integration records
- clear the configured integration

### Sync operations

- bootstrap a new encrypted sync vault
- use development plaintext bootstrap when running in dev
- register the local device
- view sync status and retry information
- pair/link another device by code or QR-assisted flow
- list synced devices
- view locally recorded sync conflicts
- export sync recovery payload details
- sign out of sync while keeping local data
- delete the cloud sync copy

### Data reset

- clear local application data
- reset local sync state after a data wipe

## PWA and offline shell

The app includes PWA metadata and asset caching so it can be installed and reopened quickly. The cached shell improves offline availability for the UI, but the actual source of truth for user content is still IndexedDB/RxDB in the browser.

## What is intentionally not server-owned

The server is not the place where:

- meals are validated as a product concept
- ingredients are calculated
- dashboard totals are derived
- AI import results are interpreted

Those behaviors stay on the client, and sync only replicates the resulting stored records.
