# HD226 pairing slot numbering

Each HD226 startup package has one immutable cluster member identity:

| Package member | Portal pairing label |
| --- | --- |
| `DEVICE_A` | `Device 1 • Screen 1` |
| `DEVICE_B` | `Device 2 • Screen 2` |
| `DEVICE_C` | `Device 3 • Screen 3` |
| `DEVICE_D` | `Device 4 • Screen 4` |
| `DEVICE_E` | `Device 5 • Screen 5` |
| `DEVICE_F` | `Device 6 • Screen 6` |
| `DEVICE_G` | `Device 7 • Screen 7` |
| `DEVICE_H` | `Device 8 • Screen 8` |
| `DEVICE_I` | `Device 9 • Screen 9` |
| `DEVICE_J` | `Device 10 • Screen 10` |

The runtime derives the visible number from the ordered `CLUSTER_MEMBERS`
constant. `PairingCodeDisplay` uses that shared formatter in both compact and
full-screen pairing layouts. The label identifies the startup package slot; a
content category never changes it.

For physical deployments, prepare each card with the matching package member.
Do not copy one member package to several players. Reassignment requires the
card/package member and Portal deployment slot to agree.
