import { 
  KeyUpEvent, 
  WillAppearEvent, 
  WillDisappearEvent,
  SingletonAction,
  JsonObject,
  streamDeck,
  action
} from '@elgato/streamdeck';
import HID from 'node-hid';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';

// Create a require function
const require = createRequire(import.meta.url);

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set driver type to libusb
HID.setDriverType('libusb');

// Try to initialize HID early to catch any startup errors
try {
  streamDeck.logger.debug('Testing HID initialization...', {
    __dirname,
    import_meta_url: import.meta.url
  });
  
  // Force node-hid to load with require
  const nodeHid = require('node-hid');
  const testDevices = nodeHid.devices();
  streamDeck.logger.debug('HID initialization successful', { deviceCount: testDevices.length });
} catch (error) {
  streamDeck.logger.error('Error initializing HID:', { 
    error,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
}

interface BatteryState {
  percentage: number | null;
  isCharging: boolean;
  isConnected: boolean;
  model?: string;
}

interface Settings extends JsonObject {
  pollingInterval: number; // in seconds
}

// List of supported headsets [vendorId, productId]
const HEADSET_IDS = [
  [0x1038, 0x12ad], // Arctis 7 2019
  [0x1038, 0x1260], // Arctis 7 2017
  [0x1038, 0x1294], // Arctis Pro
  [0x1038, 0x12b3]  // Arctis 1 Wireless
];

// Product ID for the Arctis 7 Bootloader (appears when headset is connected via USB)
const ARCTIS_7_BOOTLOADER_PRODUCT_ID = 0x12ae;

@action({ UUID: 'com.0xjessel.arctis-headset-battery.battery-level' })
export class BatteryLevelAction extends SingletonAction<Settings> {
  private pollingInterval?: NodeJS.Timeout;
  private currentState: BatteryState = {
    percentage: null,
    isCharging: false,
    isConnected: false,
    model: undefined
  };

  private currentDevice?: HID.HID;
  private lastEvent?: WillAppearEvent<Settings>;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    streamDeck.logger.info('Action appearing', {
      settings: ev.payload.settings
    });
    // Store the event for later use
    this.lastEvent = ev;
    
    // Start polling when the action becomes visible
    this.startPolling(ev.payload.settings);
    await this.updateUI(ev);
  }

  override async onWillDisappear(_ev: WillDisappearEvent<Settings>): Promise<void> {
    streamDeck.logger.info('Action disappearing');
    this.lastEvent = undefined;
    // Stop polling when the action is no longer visible
    this.stopPolling();
    // Close any open device connection
    if (this.currentDevice) {
      try {
        this.currentDevice.close();
        this.currentDevice = undefined;
      } catch (error) {
        streamDeck.logger.error('Error closing device', { error });
      }
    }
  }

  private startPolling(settings?: Settings) {
    // Default to 5 seconds if not specified
    const interval = (settings?.pollingInterval ?? 5) * 1000; // Convert to milliseconds
    streamDeck.logger.debug('Starting polling', { interval });
    
    // Clear any existing interval before starting a new one
    this.stopPolling();
    
    this.pollingInterval = setInterval(() => this.updateBatteryStatus(), interval);
    // Initial update
    this.updateBatteryStatus();
  }

  private stopPolling() {
    if (this.pollingInterval) {
      streamDeck.logger.debug('Stopping polling');
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
  }

  private async updateBatteryStatus() {
    try {
      let devices: HID.Device[];
      
      try {
        const nodeHid = require('node-hid');
        devices = nodeHid.devices();
      } catch (error) {
        streamDeck.logger.error('Error calling HID.devices():', { 
          error,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
      }
      
      // Find SteelSeries devices
      const steelSeriesDevices = devices.filter(d => 
        d.manufacturer && d.manufacturer.includes('SteelSeries') &&
        HEADSET_IDS.some(id => d.vendorId === id[0] && d.productId === id[1])
      );

      if (steelSeriesDevices.length === 0) {
        streamDeck.logger.info('No supported SteelSeries headset found');
        this.updateDisconnectedState();
        return;
      }

      // First try to find the specific interface we know works (Usage: 514, UsagePage: 65347)
      const knownWorkingDevice = steelSeriesDevices.find(d => 
        d.usage === 514 && d.usagePage === 65347
      );

      let connectedDevice: HID.HID | undefined;
      let deviceInfo: HID.Device | undefined;
      let model = 'Unknown';

      if (knownWorkingDevice && knownWorkingDevice.path) {
        try {
          // Use require'd version of node-hid for consistency
          const nodeHid = require('node-hid');
          
          try {
            connectedDevice = new nodeHid.HID(knownWorkingDevice.path);
            deviceInfo = knownWorkingDevice;
          } catch (connectError) {
            streamDeck.logger.error('Error creating HID device:', { 
              error: connectError,
              message: connectError instanceof Error ? connectError.message : String(connectError),
              stack: connectError instanceof Error ? connectError.stack : undefined
            });
            throw connectError;
          }
          
          // Determine model
          if (deviceInfo.vendorId === 0x1038) {
            if (deviceInfo.productId === 0x12ad) model = 'Arctis 7 2019';
            else if (deviceInfo.productId === 0x1260) model = 'Arctis 7 2017';
            else if (deviceInfo.productId === 0x1294) model = 'Arctis Pro';
            else if (deviceInfo.productId === 0x12b3) model = 'Arctis 1 Wireless';
          }
          streamDeck.logger.info('Connected to headset', { model });
        } catch (error) {
          streamDeck.logger.error('Error connecting to known working device:', { 
            error,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
        }
      }

      // If we couldn't connect to the known working device, try each device
      if (!connectedDevice) {
        for (const device of steelSeriesDevices) {
          if (!device.path) continue;

          try {
            const nodeHid = require('node-hid');
            const tempDevice = new nodeHid.HID(device.path);
            
            try {
              tempDevice.write([0x06, 0x18]);
              const response = tempDevice.readTimeout(1000);
              
              if (response && response[2]) {
                connectedDevice = tempDevice;
                deviceInfo = device;
                
                // Determine model
                if (device.vendorId === 0x1038) {
                  if (device.productId === 0x12ad) model = 'Arctis 7 2019';
                  else if (device.productId === 0x1260) model = 'Arctis 7 2017';
                  else if (device.productId === 0x1294) model = 'Arctis Pro';
                  else if (device.productId === 0x12b3) model = 'Arctis 1 Wireless';
                }
                streamDeck.logger.info('Connected to headset', { model });
                break;
              }
            } catch (error) {
              tempDevice.close();
              continue;
            }
            
            tempDevice.close();
          } catch (error) {
            // Silently continue to next device
          }
        }
      }

      if (!connectedDevice || !deviceInfo) {
        streamDeck.logger.info('Could not find a working headset interface');
        this.updateDisconnectedState();
        return;
      }

      // Store the connected device for cleanup
      this.currentDevice = connectedDevice;

      // Get battery level
      try {
        connectedDevice.write([0x06, 0x18]);
        const response = connectedDevice.readTimeout(1000);
        
        if (!response || !response[2]) {
          throw new Error('Invalid response from headset');
        }

        // Check if charging via USB detection
        const isChargingViaUSB = this.isHeadsetChargingViaUSB();

        this.currentState = {
          percentage: Math.min(response[2], 100),
          isCharging: isChargingViaUSB,
          isConnected: true,
          model
        };

        streamDeck.logger.debug('Battery status', { 
          percentage: this.currentState.percentage,
          isCharging: this.currentState.isCharging,
          model: this.currentState.model
        });
        
        await this.updateUI(this.lastEvent);
      } catch (error) {
        streamDeck.logger.error('Error reading battery level:', { error });
        this.updateDisconnectedState();
      }
    } catch (error) {
      streamDeck.logger.error('Error updating battery status:', { error });
      this.updateDisconnectedState();
    }
  }

  private isHeadsetChargingViaUSB(): boolean {
    try {
      const nodeHid = require('node-hid');
      const devices = nodeHid.devices();
      const steelSeriesDevices = devices.filter((d: HID.Device) => 
        d.manufacturer && d.manufacturer.includes('SteelSeries') &&
        d.vendorId === 0x1038
      );
      
      const bootloaderDevices = steelSeriesDevices.filter((d: HID.Device) => 
        d.productId === ARCTIS_7_BOOTLOADER_PRODUCT_ID && 
        d.product && d.product.includes('Bootloader')
      );
      
      return bootloaderDevices.length > 0;
    } catch (error) {
      streamDeck.logger.error('Error checking if headset is charging via USB:', { 
        error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return false;
    }
  }

  private updateDisconnectedState() {
    this.currentState = {
      percentage: null,
      isCharging: false,
      isConnected: false,
      model: undefined
    };
    this.updateUI(this.lastEvent);
  }

  private async updateUI(ev?: WillAppearEvent<Settings>) {
    if (!ev) {
      streamDeck.logger.warn('No event provided to updateUI, skipping update');
      return;
    }

    if (!this.currentState.isConnected) {
      streamDeck.logger.info('Headset disconnected');
      // When disconnected, only show charging emoji if charging, otherwise show dash
      await ev.action.setTitle(this.currentState.isCharging ? '⚡' : '-');
      return;
    }

    // Add space before charging emoji when connected
    const chargingEmoji = this.currentState.isCharging ? ' ⚡' : '';
    const title = `${this.currentState.percentage}%${chargingEmoji}`;
    await ev.action.setTitle(title);
  }
} 