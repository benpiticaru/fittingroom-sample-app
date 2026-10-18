# Generated fixtures: review

At `2026-10-17T13:40:54.027Z`, provider `claude claude-sonnet-5-5`, seed 390309489, rows 25.

## Entity graph

- `job` (`jobs`, key `reference`)

## Schema notes

None.

## Records

- `supervisor/jobs`: 25

## Edges covered

- `supervisor/jobs`: `empty:parts`, `enum:priority=high`, `enum:priority=low`, `enum:priority=normal`, `enum:status=blocked`, `enum:status=complete`, `enum:status=dispatched`, `enum:status=on-site`, `enum:status=scheduled`, `generated`, `nullable:address`

## Filled mechanically after a guard failure

None.

## Possible names

None.

## Sample records

### `supervisor/jobs`

```json
[
  {
    "address": "SYN Street 1",
    "customerName": "Heath SYN-Bramble",
    "openedYear": 2026,
    "parts": [
      {
        "description": "Condenser fan motor",
        "onBackorder": true,
        "sku": "FAN-2201"
      },
      {
        "description": "Run capacitor 45/5 uF",
        "onBackorder": true,
        "sku": "CAP-4505"
      },
      {
        "description": "Contactor 2-pole 24V",
        "onBackorder": true,
        "sku": "CON-2024"
      }
    ],
    "priority": "low",
    "reference": "SYN-JOB-1",
    "slaHoursRemaining": 4,
    "status": "scheduled",
    "technician": {
      "concurrentJobs": 3,
      "displayName": "Garnet SYN-Fold",
      "handle": "SYN-HANDLE-1"
    }
  },
  {
    "address": null,
    "customerName": "Linden SYN-Pike",
    "openedYear": 2026,
    "parts": [
      {
        "description": "Thermostat wall unit",
        "onBackorder": false,
        "sku": "THM-1100"
      }
    ],
    "priority": "normal",
    "reference": "SYN-JOB-2",
    "slaHoursRemaining": 12,
    "status": "dispatched",
    "technician": {
      "concurrentJobs": 4,
      "displayName": "Heath SYN-Bramble",
      "handle": "SYN-HANDLE-2"
    }
  },
  {
    "address": "SYN Street 2",
    "customerName": "Cedar SYN-Lark",
    "openedYear": 2025,
    "parts": [],
    "priority": "high",
    "reference": "SYN-JOB-3",
    "slaHoursRemaining": 14,
    "status": "on-site",
    "technician": {
      "concurrentJobs": 4,
      "displayName": "Kestrel SYN-Moss",
      "handle": "SYN-HANDLE-3"
    }
  }
]
```
