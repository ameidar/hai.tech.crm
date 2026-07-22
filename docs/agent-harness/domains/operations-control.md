# Operations Control Domain

## Owner Role

`operations_control`

## Primary User

- Name: קים נוה
- Email: `navekim@gmail.com`

## Responsibility

The `operations_control` role owns early customer-retention and service-risk detection in the CRM.
The role is intended for follow-up work around issues that start forming before they become churn:

- repeated child absences
- repeated instructor cancellation or postponement requests
- cycle churn or profitability risk
- overdue operational tasks
- missing meeting summaries or attendance reports

## Allowed Product Areas

- Operations Control Tower: `/operations-control`
- Operational tasks: `/tasks`
- Lead follow-up: `/lead-appointments`
- WhatsApp conversations: `/whatsapp`
- Payment links: `/payment-link`
- Linked instructor workspace: `/instructor`

## Explicitly Out Of Scope

The role must not receive broad management or finance permissions.
Keep these areas blocked unless Ami explicitly approves a separate permission change:

- billing periods and monthly invoices
- Morning / accounting document creation
- financial reports
- paying bodies
- expenses
- system-user management
- audit log
- broad customer/student/cycle/meeting administration

## Production User Consolidation

Kim should operate through a single CRM login:

- canonical email: `navekim@gmail.com`
- canonical role: `operations_control`
- linked instructor record remains attached to that user
- legacy sales login `kim@hai.tech` should be inactive after migration

