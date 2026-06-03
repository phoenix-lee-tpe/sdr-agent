# Power Automate Flow: create_sdr_email_drafts

## Purpose

Create personalized SDR first-touch email drafts in the signed-in user's Outlook mailbox after the user asks to generate mailbox drafts.

This flow creates drafts only. It must not send email.

## Copilot Studio Tool Name

```text
create_sdr_email_drafts_v2
```

## Tool Owner

Attach this flow to the native Salesforce SDR wrapper agent, not to the top-level sales agent. The sales agent should route draft creation requests to the SDR wrapper agent so SDR-specific template selection, personalization, retry logic, and mailbox handling stay inside the SDR specialist.

## Trigger

Use a Copilot Studio callable Power Automate cloud flow trigger.

Recommended user-facing description:

```text
Creates personalized SDR first-touch email drafts in the user's Outlook mailbox for review. This tool never sends email.
```

## Inputs

```json
{
  "drafts": [
    {
      "leadId": "00Q123",
      "leadName": "Jane Chen",
      "company": "Example Co.",
      "to": "jane.chen@example.com",
      "subject": "Following up on your AI automation interest",
      "bodyHtml": "<p>Hi Jane,</p><p>...</p>",
      "templateName": "SDR First Touch - AI Interest",
      "source": "Salesforce SDR Agent v2"
    }
  ]
}
```

Copilot Studio tool input:

- `draftsJson`: required string.
- The string value must be a JSON object with a `drafts` array.

Input field rules inside `draftsJson`:

- `drafts`: required array.
- `to`: required for each draft.
- `subject`: required for each draft.
- `bodyHtml`: required for each draft.
- `leadName`: recommended.
- `company`: recommended.
- `leadId`: optional but useful for reporting.
- `templateName`: optional.
- `source`: optional.

## Flow Logic

1. Initialize arrays:
   - `createdDrafts`
   - `skippedDrafts`

2. Apply to each item in `drafts`.

3. If `to`, `subject`, or `bodyHtml` is missing:
   - append the item to `skippedDrafts`
   - include reason: `missing_required_email_field`
   - do not call Outlook for that item

4. If required fields are present, call Office 365 Outlook:

   ```text
   Office 365 Outlook -> Draft an email message
   ```

   Map fields:

   - To: `to`
   - Subject: `subject`
   - Body: `bodyHtml`
   - Importance: `Normal`

5. Append successful draft metadata to `createdDrafts`.

   Include:
   - `leadId`
   - `leadName`
   - `company`
   - `to`
   - `subject`
   - `draftId` if returned by the Outlook action
   - `webLink` if returned by the Outlook action
   - `templateName`

6. Return a structured response to Copilot Studio.

   Response body:

   - `result`: `string(variables('createdDrafts'))`

   Do not wrap `createdDrafts` in `json(...)` because `createdDrafts` is already an array. Using `json(variables('createdDrafts'))` causes the final response action to fail even after Outlook draft creation succeeds.

## Output

```json
{
  "status": "completed",
  "createdCount": 1,
  "skippedCount": 0,
  "createdDrafts": [
    {
      "leadId": "00Q123",
      "leadName": "Jane Chen",
      "company": "Example Co.",
      "to": "jane.chen@example.com",
      "subject": "Following up on your AI automation interest",
      "draftId": "AAMk...",
      "webLink": "https://outlook.office.com/..."
    }
  ],
  "skippedDrafts": []
}
```

## Copilot Response Guidance

After the flow returns, the sales agent should say:

```text
Created 1 Outlook draft for review. No emails were sent.
```

If any drafts were skipped:

```text
Created 4 Outlook drafts for review. Skipped 2 because recipient email was missing.
```
