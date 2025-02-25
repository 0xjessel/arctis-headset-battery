# Arctis Headset Battery - Stream Deck Plugin

A Stream Deck plugin that displays the battery level of your SteelSeries Arctis wireless headset.

## Features

- Displays battery percentage (25%, 50%, 75%, 100%)
- Shows charging status with a lightning bolt icon (⚡)
- Configurable polling interval
- Visual alert when headset is disconnected

## Supported Devices

- SteelSeries Arctis 7 (2019 Edition) - Verified
  - Product ID: `0x12ad`
  - Vendor ID: `0x1038`
  - Usage: `514`
  - UsagePage: `65347`

The following devices are supported in code but have not been verified:

- SteelSeries Arctis 7 (2017 Edition)
  - Product ID: `0x1260`
  - Vendor ID: `0x1038`
- SteelSeries Arctis Pro
  - Product ID: `0x1294`
  - Vendor ID: `0x1038`
- SteelSeries Arctis 1 Wireless
  - Product ID: `0x12b3`
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

This will:

1. Scan for compatible SteelSeries headsets
2. Display detailed information about all detected devices
3. Connect to the appropriate interface
4. Read and display the battery level and charging status

Example output:

```
Found SteelSeries devices:
Device 1:
  VendorID: 0x1038
  ProductID: 0x12ad
  Product: SteelSeries Arctis 7
  Usage: 1
  UsagePage: 12
Device 2:
  VendorID: 0x1038
  ProductID: 0x12ad
  Product: SteelSeries Arctis 7
  Usage: 514
  UsagePage: 65347
Successfully connected to Arctis 7 (Arctis 7 2019)
Headset: Arctis 7 (Arctis 7 2019)
Battery Level: 100%
Charging: No
```

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](LICENSE)

## Technical Details

### Headset Communication Protocol

The plugin communicates with the headset using the HID (Human Interface Device) protocol. Here's how the battery and charging status are read:

1. **Command**: Send `[0x06, 0x18]` to the headset
2. **Response**: The headset returns a multi-byte response with varying formats:

   **Format 1:**

   - Bytes 0-1: Echo of the command (`0x06, 0x18`)
   - Byte 2: Battery level (0-100, sometimes >100)
   - Byte 3: Charging status (0 = charging, 1 = not charging)
   - Remaining bytes: Unknown/unused

   **Format 2:**

   - Bytes 0-1: Echo of the command (`0x06, 0x18`)
   - Byte 2: Battery level (can be >100)
   - Byte 3: Possibly max battery level (0x64 = 100)
   - Byte 4: Charging status (0 = charging, 1 = not charging)
   - Remaining bytes: Unknown/unused

### Finding the Correct Interface

Not all HID interfaces on the headset support battery status reading. The plugin specifically looks for an interface with:

- Usage: `514`
- UsagePage: `65347`

This has been verified to work with the Arctis 7 2019 model, but may vary for other models.

### Charging Status

For the Arctis 7 2019 model, the charging status is indicated by either byte 3 or byte 4 of the response:

- `0` means the headset IS charging
- `1` means the headset is NOT charging

The response format can vary between connections, so the plugin checks both byte positions.

**Important Note**: We've observed that the charging status is inverted from what might be expected - when the headset is plugged in, it shows as NOT charging, and when unplugged, it shows as charging. This behavior has been verified through testing and is correctly handled in the code.

### Battery Level

The battery level is reported in byte 2 and can sometimes exceed 100%. The plugin caps the reported value at 100% for consistency.
