# Power Automate Flow: send_reviewed_sdr_drafts

## Purpose

Send reviewed SDR email drafts from the user's Outlook mailbox only after explicit user approval.

This flow must not be called during draft creation. It is only for a second-step user request such as:

```text
send these emails
send the reviewed drafts
approve and send
```

## Copilot Studio Tool Name

```text
send_reviewed_sdr_drafts
```

## Trigger

Use a Copilot Studio callable Power Automate cloud flow trigger.

Recommended user-facing description:

```text
Sends reviewed SDR email drafts from the user's Outlook mailbox after explicit user approval.
```

## Inputs

```json
{
  "drafts": [
    {
      "draftId": "AAMk...",
      "leadId": "00Q123",
      "leadName": "Jane Chen",
      "company": "Example Co.",
      "to": "jane.chen@example.com",
      "subject": "Following up on your AI automation interest"
    }
  ],
  "approvalText": "send these reviewed drafts"
}
```

Input field rules:

- `drafts`: required array.
- `draftId`: required for each draft.
- `approvalText`: required. The sales agent should only call this flow when the user explicitly approved sending.

## Flow Logic

1. Validate `approvalText`.

   The Copilot agent should already guard this, but the flow should still reject empty approval text.

2. Initialize arrays:
   - `sentEmails`
   - `skippedEmails`

3. Apply to each item in `drafts`.

4. If `draftId` is missing:
   - append to `skippedEmails`
   - include reason: `missing_draft_id`
   - do not send

5. If `draftId` is present, call the appropriate Outlook action to send the draft.

   Depending on available tenant connector actions, use one of:

   - Microsoft Graph custom connector: `POST /me/messages/{draftId}/send`
   - Office 365 Outlook connector action that sends an existing draft, if available in your environment

   If your environment does not expose a native "send draft" action, use a Graph-backed HTTP action or custom connector with delegated mailbox permissions.

6. Append successful sends to `sentEmails`.

7. Return a structured response to Copilot Studio.

## Output

```json
{
  "status": "completed",
  "sentCount": 1,
  "skippedCount": 0,
  "sentEmails": [
    {
      "draftId": "AAMk...",
      "leadId": "00Q123",
      "leadName": "Jane Chen",
      "company": "Example Co.",
      "to": "jane.chen@example.com",
      "subject": "Following up on your AI automation interest"
    }
  ],
  "skippedEmails": []
}
```

## Copilot Response Guidance

After the flow returns, the sales agent should say:

```text
Sent 1 reviewed SDR email.
```

If any emails were skipped:

```text
Sent 4 reviewed SDR emails. Skipped 2 because draft IDs were missing.
```

Never claim an email was sent unless this flow returns a successful send result.
