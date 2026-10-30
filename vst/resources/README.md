# Snapshot

`snapshot.png` (600×400) and `snapshot_2.0x.png` (1200×800) are the VST3 snapshot: the workflow puts them in the bundle as `Contents/Resources/Snapshots/<class id>_snapshot.png`, the standard place for a picture of the plugin (VST3 SDK 3.6.10). Hosts that read it show it in their plugin lists; whether Reason 13 does is what this tries.

They are rendered from `snapshot.html` with headless Chrome:

```
google-chrome --headless=new --hide-scrollbars --window-size=600,400 --force-device-scale-factor=1 --screenshot=$PWD/snapshot.png file://$PWD/snapshot.html
google-chrome --headless=new --hide-scrollbars --window-size=600,400 --force-device-scale-factor=2 --screenshot=$PWD/snapshot_2.0x.png file://$PWD/snapshot.html
```
