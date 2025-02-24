# Arctis Headset Battery - Stream Deck Plugin

A Stream Deck plugin that displays the battery level of your SteelSeries Arctis wireless headset.

## Features

- Displays battery percentage (25%, 50%, 75%, 100%)
- Shows charging status with a lightning bolt icon (⚡)
- Configurable polling interval
- Visual alert when headset is disconnected

## Supported Devices

- SteelSeries Arctis 7 (2017 Edition)
  - Product ID: `0x1260`
  - Vendor ID: `0x1038`

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the plugin:
   ```bash
   npm run build
   ```

## Development

- `npm run build` - Build the plugin
- `npm run watch` - Build and watch for changes, automatically restart the plugin
- `npm run read:battery` - Test script to read battery status directly

## Testing

You can test the battery reading functionality without installing the Stream Deck plugin:

```bash
npm run read:battery
```

This will scan for compatible headsets and attempt to read their battery status.

## Troubleshooting

If your headset is in bootloader mode (Product ID: `0x12ae`), try these steps:

1. Unplug and replug the headset
2. Hold the power button for 10 seconds to force a reset
3. Use SteelSeries Engine to update the firmware if needed

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](LICENSE)
