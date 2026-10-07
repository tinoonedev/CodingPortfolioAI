# Demo client brief: Northstar Studio booking web app

> Fictional planning example only. This document contains no real client data and does not authorize a Jira project, customer contact, payment, or deployment.

## Client and outcome

Northstar Studio is a fictional one-location yoga studio. The client wants a small public web app where a visitor can view available classes and reserve one seat using an email address.

**Primary actor:** a prospective attendee.

**Success outcome:** the attendee can find a scheduled class, reserve an available seat, and see a confirmation without submitting payment.

**Demo assumption:** since Northstar Studio is fictional, the one-location booking flow and staff access model are proposed scope for review, not validated client decisions.

## MVP scope

- Public class list with class name, start time, instructor, and remaining capacity.
- Reservation form with attendee name and email.
- Confirmation page with a reservation reference.
- Capacity is checked when a reservation is submitted.
- Studio staff can view reservations for a class through a protected staff view.

## Constraints and exclusions

- One studio location and one configured time zone.
- The configured time zone is `Europe/Madrid`; class times are displayed in that time zone.
- Attendee name is required and limited to 1–80 characters after trimming; email is required and limited to 254 characters with a valid address syntax.
- Reservations do not collect money or sensitive health information.
- No recurring memberships, waitlist, calendar sync, marketing automation, or multi-location administration.
- If class data cannot load, the page must show an error and a retry action; it must not claim that a class list is current.
- A class with no remaining capacity cannot accept another reservation.

## Acceptance criteria

```gherkin
Feature: Reserve a seat in a Northstar Studio class
  As a prospective attendee
  I want to view classes and reserve an available seat
  So that I can attend a scheduled class

  Rule: Only classes with remaining capacity accept reservations

    @smoke
    Scenario: Reserve an available class
      Given a published class has one or more seats remaining
      And the visitor provides a non-empty name and valid email address
      When the visitor submits a reservation for that class
      Then the system creates one reservation for the visitor
      And the confirmation page shows the reservation reference and class start time

    @sanity
    Scenario: Reject a reservation when the class is full
      Given a published class has zero seats remaining
      When the visitor submits a reservation for that class
      Then the system does not create a reservation
      And the page states that the class is full

    @regression
    Scenario: Prevent reservations from exceeding class capacity
      Given a published class has one seat remaining
      And two visitors submit valid reservations for that class at the same time
      When the system processes both submissions
      Then exactly one reservation is created
      And the other visitor is told that the class is full

  Rule: Contact details must be valid before a reservation is created

    @regression
    Scenario: Reject an invalid email address
      Given a published class has a seat available
      And the visitor enters a name and an invalid email address
      When the visitor submits the reservation
      Then the system does not create a reservation
      And the email field explains that a valid email address is required

  Rule: The public class list reports availability failures honestly

    @sanity
    Scenario: Retry after the class list fails to load
      Given the class-list service returns an error
      When the visitor opens the class page
      Then the page shows that class information is unavailable
      And the page offers a retry action
      And the page does not show an empty list as if no classes were scheduled

  Rule: Reservation details are visible only to authorized studio staff

    @smoke
    Scenario: Allow authenticated staff to view class reservations
      Given studio staff have an authenticated staff session
      And a class has a reservation with attendee name and email
      When the staff member opens that class's reservation view
      Then the view shows the reservation details for that class
      And it does not show reservations for a different class

    @sanity
    Scenario: Deny a visitor access to the staff reservation view
      Given a visitor does not have an authenticated studio staff session
      When the visitor requests the staff reservation view
      Then the system denies access
      And the system does not reveal attendee names or email addresses
```

## Delivery evidence expected

- Reviewed Gherkin linked to the selected Jira work item before implementation.
- Integration coverage for capacity enforcement and duplicate-submit protection.
- Browser smoke/sanity evidence for a successful booking, full class, invalid email, and unavailable class service.
- A preview URL and build/check evidence before the client demo is accepted.
