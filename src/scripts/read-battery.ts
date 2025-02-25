import HID from 'node-hid';

/**
 * ⚠️ CRITICAL PRE-RELEASE TODO ⚠️
 * 
 * Battery level reporting needs to be tested at various charge levels (75%, 50%, 25%, near empty)
 * to verify whether the Arctis 7 2019 reports battery levels as 0-100 values or uses a different scale.
 * 
 * Current implementation assumes 0-100 values based on testing at 100% battery level only.
 * This assumption must be verified before release.
 * 
 * See README.md and PRD.mdx for more details.
 */

/**
 * ℹ️ CHARGING DETECTION DISCOVERY ℹ️
 * 
 * While we couldn't reliably determine charging status from the HID response bytes,
 * we discovered that when the headset is connected directly to the PC via USB for charging,
 * additional USB devices appear with product ID 0x12ae and the name "SteelSeries Arctis 7 Bootloader".
 * 
 * This allows us to detect when the headset is charging via USB by looking for these bootloader devices.
 * Note that this only works when the headset is charging via the PC's USB port and won't detect
 * charging from other power sources (like wall adapters).
 */

// Set driver type to libusb
HID.setDriverType('libusb');

// List of supported headsets [vendorId, productId]
const HEADSET_IDS = [
  [0x1038, 0x12ad], // Arctis 7 2019
  [0x1038, 0x1260], // Arctis 7 2017
  [0x1038, 0x1294], // Arctis Pro
  [0x1038, 0x12b3]  // Arctis 1 Wireless
];

// Product ID for the Arctis 7 Bootloader (appears when headset is connected via USB)
const ARCTIS_7_BOOTLOADER_PRODUCT_ID = 0x12ae;

// Interface for headset device information
export interface HeadsetDevice {
  device: HID.HID;
  info: HID.Device;
  name: string;
  model: string;
}

/**
 * Check if the headset is charging via direct USB connection
 * This works by detecting if there are additional USB devices from SteelSeries
 * with product ID 0x12ae and name "SteelSeries Arctis 7 Bootloader"
 * 
 * These bootloader devices appear when the headset is connected directly via USB for charging
 * 
 * Note: This only works when the headset is charging via the PC's USB port
 * and won't detect charging from other power sources (like wall adapters)
 * 
 * @param verbose Whether to log detailed information
 * @returns True if the headset appears to be charging via USB, false otherwise
 */
export function isHeadsetChargingViaUSB(verbose = false): boolean {
  try {
    // Get all HID devices
    const devices = HID.devices();
    
    // Find all SteelSeries devices with the same vendor ID
    const steelSeriesDevices = devices.filter(d => 
      d.manufacturer && d.manufacturer.includes('SteelSeries') &&
      d.vendorId === 0x1038
    );
    
    if (verbose && steelSeriesDevices.length > 0) {
      console.log('Found SteelSeries devices:');
      steelSeriesDevices.forEach((device, index) => {
        console.log(`Device ${index + 1}:`);
        console.log(`  VendorID: 0x${device.vendorId?.toString(16)}`);
        console.log(`  ProductID: 0x${device.productId?.toString(16)}`);
        console.log(`  Product: ${device.product}`);
        console.log(`  Usage: ${device.usage}`);
        console.log(`  UsagePage: ${device.usagePage}`);
        console.log(`  Path: ${device.path}`);
      });
    }
    
    // Look specifically for the Arctis 7 Bootloader device (product ID 0x12ae)
    // This appears when the headset is connected directly via USB for charging
    const bootloaderDevices = steelSeriesDevices.filter(d => 
      d.productId === ARCTIS_7_BOOTLOADER_PRODUCT_ID && 
      d.product && d.product.includes('Bootloader')
    );
    
    if (verbose) {
      console.log(`Found ${bootloaderDevices.length} Arctis 7 Bootloader devices`);
    }
    
    // If we found any bootloader devices, the headset is charging via USB
    const isChargingViaUSB = bootloaderDevices.length > 0;
    
    if (verbose) {
      console.log(`Headset charging via USB: ${isChargingViaUSB}`);
    }
    
    return isChargingViaUSB;
  } catch (error) {
    console.error('Error checking if headset is charging via USB:', error);
    return false;
  }
}

/**
 * Find and connect to a supported SteelSeries Arctis headset
 * @param verbose Whether to log detailed information
 * @returns A connected headset device or null if no headset is found
 */
export async function getHeadset(verbose = false): Promise<HeadsetDevice | null> {
  try {
    // Get all HID devices
    const devices = HID.devices();
    
    // Find SteelSeries devices
    const steelSeriesDevices = devices.filter(d => 
      d.manufacturer && d.manufacturer.includes('SteelSeries') &&
      HEADSET_IDS.some(id => d.vendorId === id[0] && d.productId === id[1])
    );
    
    if (steelSeriesDevices.length === 0) {
      if (verbose) console.log('No supported SteelSeries headset found');
      return null;
    }
    
    // Log all found devices if verbose
    if (verbose) {
      console.log('Found SteelSeries devices:');
      steelSeriesDevices.forEach((device, index) => {
        console.log(`Device ${index + 1}:`);
        console.log(`  VendorID: 0x${device.vendorId?.toString(16)}`);
        console.log(`  ProductID: 0x${device.productId?.toString(16)}`);
        console.log(`  Product: ${device.product}`);
        console.log(`  Usage: ${device.usage}`);
        console.log(`  UsagePage: ${device.usagePage}`);
      });
    }
    
    // First try to find the specific interface we know works (Usage: 514, UsagePage: 65347)
    const knownWorkingDevice = steelSeriesDevices.find(d => 
      d.usage === 514 && d.usagePage === 65347
    );
    
    if (knownWorkingDevice && knownWorkingDevice.path) {
      try {
        const hidDevice = new HID.HID(knownWorkingDevice.path);
        const name = knownWorkingDevice.product?.replace('SteelSeries ', '') || 'Unknown';
        
        // Determine the model based on vendorId and productId
        let model = 'Unknown';
        if (knownWorkingDevice.vendorId === 0x1038) {
          if (knownWorkingDevice.productId === 0x12ad) model = 'Arctis 7 2019';
          else if (knownWorkingDevice.productId === 0x1260) model = 'Arctis 7 2017';
          else if (knownWorkingDevice.productId === 0x1294) model = 'Arctis Pro';
          else if (knownWorkingDevice.productId === 0x12b3) model = 'Arctis 1 Wireless';
        }
        
        if (verbose) {
          console.log(`Successfully connected to ${name} (${model})`);
          console.log(`VendorID: 0x${knownWorkingDevice.vendorId?.toString(16)}, ProductID: 0x${knownWorkingDevice.productId?.toString(16)}`);
        }
        
        return {
          device: hidDevice,
          info: knownWorkingDevice,
          name,
          model
        };
      } catch (error) {
        if (verbose) console.error('Error connecting to known working device:', error);
      }
    }
    
    // If we couldn't connect to the known working device, try each device
    for (const deviceInfo of steelSeriesDevices) {
      if (!deviceInfo.path) continue;
      
      try {
        const hidDevice = new HID.HID(deviceInfo.path);
        
        // Try to get battery level to verify this is the correct interface
        try {
          hidDevice.write([0x06, 0x18]);
          const response = hidDevice.readTimeout(1000);
          
          if (response && response[2]) {
            // This is the correct interface
            const name = deviceInfo.product?.replace('SteelSeries ', '') || 'Unknown';
            
            // Determine the model based on vendorId and productId
            let model = 'Unknown';
            if (deviceInfo.vendorId === 0x1038) {
              if (deviceInfo.productId === 0x12ad) model = 'Arctis 7 2019';
              else if (deviceInfo.productId === 0x1260) model = 'Arctis 7 2017';
              else if (deviceInfo.productId === 0x1294) model = 'Arctis Pro';
              else if (deviceInfo.productId === 0x12b3) model = 'Arctis 1 Wireless';
            }
            
            if (verbose) {
              console.log(`Successfully connected to ${name} (${model})`);
              console.log(`VendorID: 0x${deviceInfo.vendorId?.toString(16)}, ProductID: 0x${deviceInfo.productId?.toString(16)}`);
            }
            
            return {
              device: hidDevice,
              info: deviceInfo,
              name,
              model
            };
          }
        } catch (writeError: unknown) {
          // Not the right interface, close and try next
          hidDevice.close();
          continue;
        }
        
        // If we get here, we couldn't read the battery but opened the device
        hidDevice.close();
      } catch (openError: unknown) {
        // Silently continue to the next device
      }
    }
    
    if (verbose) console.log('Could not find a working headset interface');
    return null;
  } catch (error) {
    if (verbose) console.error('Error finding headset:', error);
    return null;
  }
}

/**
 * Get the battery level of a connected headset
 * @param headset The connected headset device
 * @returns The battery level (0-100) or null if it cannot be read
 */
export async function getBatteryLevel(headset: HeadsetDevice): Promise<number | null> {
  try {
    headset.device.write([0x06, 0x18]);
    const response = headset.device.readTimeout(1000);
    
    // The battery level is in the 2nd byte (index 2)
    // Value is 0-100 representing percentage
    if (response && response[2]) {
      // Cap the battery level at 100%
      return Math.min(response[2], 100);
    }
    
    return null;
  } catch (error) {
    console.error('Error reading battery level:', error);
    return null;
  }
}

/**
 * Get the full response from the headset
 * @param headset The connected headset device
 * @returns The full response buffer or null if it cannot be read
 */
export async function getFullResponse(headset: HeadsetDevice): Promise<Buffer | null> {
  try {
    // Send command 0x06, 0x18 to request battery status
    headset.device.write([0x06, 0x18]);
    const response = headset.device.readTimeout(1000);
    
    // Response format for Arctis 7 2019:
    // Byte 0-1: Echo of the command (0x06, 0x18)
    // Byte 2: Battery level (0-100)
    //   - If 0, the headset is likely off or disconnected
    //   - If >0, the headset is on and connected (typically around 100-102)
    // 
    // Note: Based on our tests, we couldn't reliably determine the charging status
    // from the response bytes. The pattern doesn't match what we expected from other
    // implementations.
    if (response) {
      return Buffer.from(response);
    }
    
    return null;
  } catch (error) {
    console.error('Error getting full response:', error);
    return null;
  }
}

/**
 * Close the headset device connection
 * @param headset The connected headset device
 */
export function closeHeadset(headset: HeadsetDevice): void {
  try {
    headset.device.close();
  } catch (error) {
    console.error('Error closing headset:', error);
  }
}

/**
 * Main function to run the script
 */
async function main() {
  try {
    // Check if the headset is charging via USB before connecting
    const isChargingViaUSB = isHeadsetChargingViaUSB(true);
    
    const headset = await getHeadset(true);
    
    if (!headset) {
      console.log('Could not connect to headset');
      process.exit(1);
    }
    
    const batteryLevel = await getBatteryLevel(headset);
    const fullResponse = await getFullResponse(headset);
    
    console.log(`Headset: ${headset.name} (${headset.model})`);
    
    if (batteryLevel === 0) {
      console.log('Battery Level: Unknown (headset may be off or disconnected)');
    } else if (batteryLevel !== null) {
      console.log(`Battery Level: ${batteryLevel}%`);
    } else {
      console.log('Battery Level: Unknown');
    }
    
    // Display charging status based on USB detection
    console.log(`Charging via USB: ${isChargingViaUSB ? 'Yes' : 'No'} (detected by USB device presence)`);
    
    if (fullResponse) {
      console.log('Full response:', fullResponse);
      
      // Check all bytes for analysis
      console.log('\nDetailed response analysis:');
      for (let i = 0; i < fullResponse.length; i++) {
        console.log(`Byte ${i}: ${fullResponse[i]} (0x${fullResponse[i].toString(16).padStart(2, '0')})`);
      }
    }
    
    // Close the device when done
    closeHeadset(headset);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Only run the main function if this script is executed directly
// In ES modules, we can check if this is the main module by comparing import.meta.url
const isMainModule = import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule) {
  main();
} 