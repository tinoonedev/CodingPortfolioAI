# Demo client brief: ParcelPath shipment status API

> Fictional planning example only. This document contains no real client data and does not authorize a customer integration or API deployment.

## Client and outcome

ParcelPath is a fictional small delivery company. The client wants an API that lets an authenticated merchant create a shipment record and retrieve its current status by a stable reference.

**Primary actor:** an authenticated merchant system.

**Success outcome:** a merchant can create a shipment request once and later retrieve the latest status without exposing another merchant’s shipment data.

**Demo assumption:** because ParcelPath is fictional, the merchant-managed status sequence and request limits are proposed scope for review, not validated client decisions.

## MVP scope

- Authenticated shipment creation with non-empty recipient name, destination postal code, and an idempotency key unique to that merchant.
- Recipient name is trimmed and limited to 1–100 characters; destination postal code is a non-empty string limited to 16 characters.
- A stable shipment reference returned after creation.
- Retrieval of status and creation timestamp by shipment reference.
- Status values are `received`, `in_transit`, and `delivered`.
- The owning merchant can advance status one step at a time: `received` → `in_transit` → `delivered`.
- JSON error responses with a stable machine-readable error code.

## Constraints and exclusions

- API clients use server-issued credentials; credentials must not be included in URLs or routine logs.
- A shipment belongs to one merchant identity; every read checks the authenticated merchant owns the shipment.
- The API version is `/v1`; each merchant may make at most 120 requests per rolling minute. A rejected rate-limited request returns HTTP 429, error code `RATE_LIMIT_EXCEEDED`, and a `Retry-After` value.
- An idempotency key is retained for 24 hours. Reusing it with the same request returns the original shipment; reusing it with changed shipment details returns HTTP 409 and does not create a shipment.
- The demo does not connect to a carrier, calculate prices, print labels, store payment data, or expose public tracking links.
- The API documents request limits and its supported version. A server error must not return a success-shaped response.

## Acceptance criteria

```gherkin
Feature: Manage merchant shipment records
  As an authenticated merchant system
  I want to create and retrieve shipment records
  So that I can track the delivery requests I submitted

  Rule: Shipment creation requires an authenticated merchant and valid input

    @smoke
    Scenario: Create a valid shipment
      Given a merchant has valid API credentials
      And the merchant submits a recipient name and destination postal code
      And the request includes a new idempotency key
      When the merchant creates a shipment
      Then the API returns HTTP 201 with a shipment reference and status "received"
      And the API stores the shipment under the authenticated merchant

    @sanity
    Scenario: Reject a request without valid credentials
      Given a request has no valid merchant credentials
      When the client submits a shipment creation request
      Then the API returns HTTP 401 with error code "UNAUTHENTICATED"
      And the API does not create a shipment

    @regression
    Scenario: Return the original result for a repeated idempotency key
      Given a merchant has already created a shipment with an idempotency key
      When the merchant repeats the same request with that key
      Then the API returns the original shipment reference
      And the API does not create a second shipment

    @regression
    Scenario: Reject an idempotency key reused with different shipment details
      Given a merchant has created a shipment using an idempotency key
      When the merchant reuses that key with different shipment details
      Then the API returns HTTP 409 with error code "IDEMPOTENCY_KEY_CONFLICT"
      And the API does not create another shipment

    @sanity
    Scenario: Reject a request that exceeds the merchant rate limit
      Given a merchant has already made 120 requests during the previous 60 seconds
      When the merchant sends another request
      Then the API returns HTTP 429 with error code "RATE_LIMIT_EXCEEDED"
      And the response includes a Retry-After value
      And the API does not process the rejected operation

  Rule: Shipment reads are isolated by merchant identity

    @sanity
    Scenario: Deny a merchant access to another merchant shipment
      Given merchant A owns a shipment reference
      And merchant B has valid API credentials
      When merchant B requests merchant A's shipment reference
      Then the API returns HTTP 404 with error code "NOT_FOUND"
      And the API does not reveal the shipment status or recipient details

  Rule: Shipment status changes follow the declared sequence

    @smoke
    Scenario: Advance an owned shipment to in transit
      Given a merchant owns a shipment with status "received"
      When the merchant changes the status to "in_transit"
      Then the API returns HTTP 200 with status "in_transit"
      And the API records the status change time

    @sanity
    Scenario: Reject a status transition that skips a step
      Given a merchant owns a shipment with status "received"
      When the merchant changes the status directly to "delivered"
      Then the API returns HTTP 409 with error code "INVALID_STATUS_TRANSITION"
      And the shipment status remains "received"

  Rule: Service failures do not appear as successful shipment operations

    @regression
    Scenario: Report a storage failure during shipment creation
      Given the shipment store is unavailable
      And the merchant has valid credentials and a valid request
      When the merchant creates a shipment
      Then the API returns HTTP 503 with error code "STORAGE_UNAVAILABLE" and a correlation identifier
      And the API does not return a shipment reference as if creation succeeded
```

## Delivery evidence expected

- Reviewed Gherkin linked to the selected Jira work item before implementation.
- Unit coverage for input validation and status serialization.
- Integration coverage for authentication, idempotency, tenant isolation, and storage failure handling.
- Smoke/sanity evidence from the actual API process, request/response examples, OpenAPI document, and security review before acceptance.
