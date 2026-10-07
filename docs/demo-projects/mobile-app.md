# Demo client brief: PocketPantry mobile app

> Fictional planning example only. This document contains no real client data and does not authorize a repository, Jira, store, or deployment action.

## Client and outcome

PocketPantry is a fictional household grocery-planning client. The client wants a small mobile app that lets one person keep a grocery list on a phone and mark items as purchased while shopping.

**Primary actor:** a household member using the app on one device.

**Success outcome:** the member can create, review, and update a device-local list without creating an account.

**Demo assumption:** because PocketPantry is fictional, the one-device, no-account workflow is a proposed scope for review, not a validated client decision.

## MVP scope

- One active grocery list on one device.
- Add an item with a trimmed name of 1–100 characters; quantity is optional and defaults to 1, and unit is optional.
- Mark an item as purchased and undo that state.
- Preserve the list after the app closes and reopens.
- Show validation errors next to invalid input.

## Constraints and exclusions

- Target iOS and Android phones using a shared mobile implementation.
- List data is stored on the device for this demo; there is no server sync or multi-device sharing.
- No account creation, payments, barcode scanning, recipe recommendations, retailer integration, or background location.
- If device storage is unavailable or a save fails, the app must report the failure and retain the unsaved form values while the screen remains open.

## Acceptance criteria

```gherkin
Feature: Maintain a device-local grocery list
  As a household member
  I want to add and update grocery items on my phone
  So that I can use one persistent list while shopping

  Rule: A grocery item must have a non-empty name

    @smoke
    Scenario: Add an item with a valid name
      Given the member has opened the empty grocery list
      When the member enters "Oats" and saves the item
      Then the list shows one item named "Oats" with an unpurchased state
      And the app persists the item on the device

    @regression
    Scenario: Use the default quantity when none is entered
      Given the member is adding a grocery item
      When the member saves an item named "Oats" without entering a quantity
      Then the list shows the item with quantity 1

    @sanity
    Scenario: Reject an item with a blank name
      Given the member is adding a grocery item
      When the member saves the item without a name
      Then the item is not added to the list
      And the form identifies that a name is required

    @regression
    Scenario: Reject an item name longer than 100 characters
      Given the member is adding a grocery item
      When the member saves a name longer than 100 characters
      Then the item is not added to the list
      And the name field identifies the 100-character limit

    @regression
    Scenario: Reject a non-positive quantity
      Given the member is adding a grocery item
      When the member enters a quantity of zero or less and saves the item
      Then the item is not added to the list
      And the quantity field identifies that the value must be greater than zero

  Rule: Purchase state and saved items survive an app restart

    @regression
    Scenario: Restore the list after reopening the app
      Given the member has saved an item named "Oats"
      And the app has been closed
      When the member opens the app again on the same device
      Then the list shows "Oats" with its last saved purchase state

    @sanity
    Scenario: Report a local save failure
      Given device storage returns a save error while the member adds an item
      When the app attempts to save the item
      Then the app displays a save failure
      And the unsaved item values remain available in the open form
      And the app does not display the item as persisted
```

## Delivery evidence expected

- Reviewed Gherkin linked to the selected Jira work item before implementation.
- Unit coverage for input validation and purchase-state rules.
- Smoke and sanity coverage on supported iOS and Android runtimes for list creation, restart persistence, and visible save errors; browser-only tests do not count as native mobile evidence.
- An installable test build and device/version details before the mobile demo is accepted.
