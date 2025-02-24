import HID from 'node-hid';

// Arctis 7 USB identifiers
const VENDOR_ID = 0x1038;
const PRODUCT_IDS = {
  BOOTLOADER: 0x12ae,  // Bootloader mode
  NORMAL: 0x1260,      // Normal mode
  WIRELESS: 0x1294     // Another reported ID
};

// Battery status commands to try
const COMMANDS = [
  { name: 'Standard', cmd: Buffer.from([0x06, 0x18]) },
  { name: 'Alternative1', cmd: Buffer.from([0x06, 0x14]) },
  { name: 'Alternative2', cmd: Buffer.from([0x06, 0x24]) },
  { name: 'Alternative3', cmd: Buffer.from([0x06, 0x12]) },
  { name: 'Bootloader1', cmd: Buffer.from([0x06, 0x01]) },
  { name: 'Bootloader2', cmd: Buffer.from([0x01, 0x06]) }
];

const RESPONSE_LENGTH = 31;
const BATTERY_LEVEL_BYTE = 2;
const CHARGING_STATUS_BYTE = 4;
const CHARGING_STATUS_MASK = 0x10;

/**
 * Convert raw battery level to percentage
 * The Arctis 7 only reports battery levels in 25% increments
 */
function convertBatteryLevel(rawLevel: number): 25 | 50 | 75 | 100 | null {
  if (rawLevel >= 0x64) return 100;
  if (rawLevel >= 0x4B) return 75;
  if (rawLevel >= 0x32) return 50;
  if (rawLevel >= 0x19) return 25;
  return null;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tryCommand(device: HID.HID, command: Buffer, name: string): Promise<Buffer | null> {
  try {
    console.log(`Trying ${name} command:`, command);
    device.write(command);
    await sleep(100); // Wait a bit for the device to respond
    const response = device.readTimeout(1000);
    console.log(`Response from ${name} command:`, response);
    return Buffer.from(response);
  } catch (error) {
    console.log(`Error with ${name} command:`, error);
    return null;
  }
}

async function tryInterface(deviceInfo: HID.Device, interfaceNumber: number) {
  console.log(`\nTrying interface ${interfaceNumber}...`);
  try {
    if (!deviceInfo.path) {
      throw new Error('Device path is undefined');
    }
    
    // node-hid expects a numeric path on macOS
    const numericPath = deviceInfo.path.replace('DevSrvsID:', '');
    const device = new HID.HID(numericPath);
    console.log(`Successfully opened HID device on interface ${interfaceNumber}`);
    
    // Try each command sequence
    for (const { name, cmd } of COMMANDS) {
      const response = await tryCommand(device, cmd, name);
      
      if (response && response.length >= RESPONSE_LENGTH) {
        const rawBatteryLevel = response[BATTERY_LEVEL_BYTE];
        const chargingStatus = response[CHARGING_STATUS_BYTE];
        const isCharging = (chargingStatus & CHARGING_STATUS_MASK) !== 0;
        const percentage = convertBatteryLevel(rawBatteryLevel);
        
        console.log(`Battery Status (from ${name} command):`, {
          percentage: percentage ? `${percentage}%` : 'Unknown',
          isCharging: isCharging ? 'Yes ⚡' : 'No',
          rawBatteryLevel: `0x${rawBatteryLevel.toString(16)}`,
          chargingStatus: `0x${chargingStatus.toString(16)}`
        });
      }
      
      await sleep(500); // Wait between commands
    }

    // Close the device
    device.close();
    console.log(`Closed HID device on interface ${interfaceNumber}`);
    return true;
  } catch (error) {
    console.log(`Error on interface ${interfaceNumber}:`, error);
    return false;
  }
}

async function main() {
  try {
    console.log('Scanning for HID devices...');
    const devices = HID.devices();
    
    console.log('Found HID devices:', devices.map(d => ({
      vendorId: d.vendorId?.toString(16),
      productId: d.productId?.toString(16),
      manufacturer: d.manufacturer,
      product: d.product,
      path: d.path,
      interface: d.interface,
      usage: d.usage,
      usagePage: d.usagePage
    })));

    // Try to find any SteelSeries headset
    const headset = devices.find(
      (device) =>
        device.vendorId === VENDOR_ID &&
        (device.productId === PRODUCT_IDS.BOOTLOADER ||
         device.productId === PRODUCT_IDS.NORMAL ||
         device.productId === PRODUCT_IDS.WIRELESS)
    );

    if (!headset || !headset.path) {
      console.error('No compatible headset found');
      process.exit(1);
    }

    console.log('Found compatible headset:', {
      path: headset.path,
      manufacturer: headset.manufacturer,
      product: headset.product,
      interface: headset.interface,
      usage: headset.usage,
      usagePage: headset.usagePage
    });

    // Try different interface numbers
    for (let i = 0; i < 3; i++) {
      const success = await tryInterface(headset, i);
      if (success) break;
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main(); 