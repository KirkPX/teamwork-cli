# Task notifications

Teamwork's V3 task creation can skip notifying assignees. Tests against a live site
confirmed this: a task created with `notify: true` sent an email, and one created with
`notify: false` did not.

- `task.notify = false` stops human notifications for a new task.
- `taskOptions.notify = false` says the same thing through the options object. Set
  both to the same value, so the intent is explicit in both places.
- `taskOptions.useNotifyViaTWIM = false` stops delivery through Teamwork's instant messaging.
- `fireWebhook=false` is a query parameter that stops webhooks only. It does not stop emails.

```text
POST /projects/api/v3/tasklists/{tasklistId}/tasks.json?fireWebhook=false
```

```json
{
  "task": {
    "tasklistId": 1,
    "name": "Task name",
    "assignees": { "userIds": [2] },
    "notify": false
  },
  "taskOptions": {
    "notify": false,
    "useNotifyViaTWIM": false
  }
}
```
