import HID from 'node-hid';

// Set driver type to libusb
HID.setDriverType('libusb');

// List of supported headsets [vendorId, productId]
const HEADSET_IDS = [
  [0x1038, 0x12ad], // Arctis 7 2019
  [0x1038, 0x1260], // Arctis 7 2017
  [0x1038, 0x1294], // Arctis Pro
  [0x1038, 0x12b3]  // Arctis 1 Wireless
];

// Interface for headset device information
export interface HeadsetDevice {
  device: HID.HID;
  info: HID.Device;
  name: string;
  model: string;
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
 * Check if the headset is currently charging
 * @param headset The connected headset device
 * @returns True if the headset is charging, false if not, null if it cannot be determined
 */
export async function isCharging(headset: HeadsetDevice): Promise<boolean | null> {
  try {
    headset.device.write([0x06, 0x18]);
    const response = headset.device.readTimeout(1000);
    
    // The response format can vary, so we need to check multiple bytes
    if (response && response.length > 4) {
      // First check byte 3 (index 3)
      if (response[3] === 0 || response[3] === 1) {
        return response[3] === 0; // 0 means charging, 1 means not charging
      }
      
      // If byte 3 doesn't look like a charging indicator, check byte 4 (index 4)
      if (response[4] === 0 || response[4] === 1) {
        return response[4] === 0; // 0 means charging, 1 means not charging
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error checking charging status:', error);
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
    
    // Response format for Arctis 7 2019 can vary:
    // Format 1:
    // Byte 0-1: Echo of the command (0x06, 0x18)
    // Byte 2: Battery level (0-100)
    // Byte 3: Charging status (0 = charging, 1 = not charging)
    // Remaining bytes: Unknown/unused
    //
    // Format 2:
    // Byte 0-1: Echo of the command (0x06, 0x18)
    // Byte 2: Battery level (can be >100)
    // Byte 3: Possibly max battery level (0x64 = 100)
    // Byte 4: Charging status (0 = charging, 1 = not charging)
    // Remaining bytes: Unknown/unused
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
    const headset = await getHeadset(true);
    
    if (!headset) {
      console.log('Could not connect to headset');
      process.exit(1);
    }
    
    const batteryLevel = await getBatteryLevel(headset);
    const charging = await isCharging(headset);
    const fullResponse = await getFullResponse(headset);
    
    console.log(`Headset: ${headset.name} (${headset.model})`);
    console.log(`Battery Level: ${batteryLevel !== null ? `${batteryLevel}%` : 'Unknown'}`);
    console.log(`Charging: ${charging !== null ? (charging ? 'Yes' : 'No') : 'Unknown'}`);
    
    if (fullResponse) {
      console.log('Full response:', fullResponse);
      
      // Check all bytes for potential charging indicators
      console.log('\nDetailed response analysis:');
      for (let i = 0; i < fullResponse.length; i++) {
        console.log(`Byte ${i}: ${fullResponse[i]} (0x${fullResponse[i].toString(16).padStart(2, '0')})`);
      }
      
      // Check if any byte is 1, which might indicate charging
      const potentialChargingBytes = [];
      for (let i = 0; i < fullResponse.length; i++) {
        if (fullResponse[i] === 1) {
          potentialChargingBytes.push(i);
        }
      }
      
      if (potentialChargingBytes.length > 0) {
        console.log(`\nPotential charging indicators found at byte(s): ${potentialChargingBytes.join(', ')}`);
      } else {
        console.log('\nNo potential charging indicators found (no bytes with value 1)');
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