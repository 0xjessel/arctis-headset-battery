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

interface BatteryState {
  percentage: 25 | 50 | 75 | 100 | null;
  isCharging: boolean;
  isConnected: boolean;
}

interface Settings extends JsonObject {
  pollingInterval: number; // in seconds
}

@action({ UUID: 'com.0xjessel.arctis-headset-battery.battery-level' })
export class BatteryLevelAction extends SingletonAction<Settings> {
  
  private pollingInterval?: NodeJS.Timeout;
  private currentState: BatteryState = {
    percentage: null,
    isCharging: false,
    isConnected: false,
  };

  // Arctis 7 (2017 Edition) USB identifiers
  private static readonly VENDOR_ID = 0x1038;
  private static readonly PRODUCT_ID = 0x1260;

  // Battery status command and response constants
  private static readonly BATTERY_STATUS_COMMAND = [0x06, 0x18];
  private static readonly RESPONSE_LENGTH = 31;
  private static readonly BATTERY_LEVEL_BYTE = 2;
  private static readonly CHARGING_STATUS_BYTE = 4;
  private static readonly CHARGING_STATUS_MASK = 0x10;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    streamDeck.logger.info('Action appearing', {
      settings: ev.payload.settings
    });
    // Start polling when the action becomes visible
    this.startPolling(ev.payload.settings);
    await this.updateUI(ev);
  }

  override async onWillDisappear(_ev: WillDisappearEvent<Settings>): Promise<void> {
    streamDeck.logger.info('Action disappearing');
    // Stop polling when the action is no longer visible
    this.stopPolling();
  }

  private startPolling(settings?: Settings) {
    const interval = (settings?.pollingInterval ?? 30) * 1000; // Convert to milliseconds
    streamDeck.logger.debug('Starting polling', { interval });
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

  /**
   * Convert raw battery level to percentage
   * The Arctis 7 only reports battery levels in 25% increments
   */
  private static convertBatteryLevel(rawLevel: number): 25 | 50 | 75 | 100 | null {
    streamDeck.logger.trace('Converting battery level', {
      raw: `0x${rawLevel.toString(16)}`
    });
    if (rawLevel >= 0x64) return 100;
    if (rawLevel >= 0x4B) return 75;
    if (rawLevel >= 0x32) return 50;
    if (rawLevel >= 0x19) return 25;
    return null;
  }

  private async updateBatteryStatus() {
    let device: HID.HID | undefined;
    
    try {
      streamDeck.logger.debug('Scanning for HID devices...');
      const devices = HID.devices();
      streamDeck.logger.trace('Found HID devices', {
        devices: devices.map(d => ({
          vendorId: d.vendorId?.toString(16),
          productId: d.productId?.toString(16),
          manufacturer: d.manufacturer,
          product: d.product
        }))
      });

      const headset = devices.find(
        (device) =>
          device.vendorId === BatteryLevelAction.VENDOR_ID &&
          device.productId === BatteryLevelAction.PRODUCT_ID
      );

      if (!headset || !headset.path) {
        streamDeck.logger.info('No compatible headset found');
        this.currentState = {
          percentage: null,
          isCharging: false,
          isConnected: false,
        };
        await this.updateUI();
        return;
      }

      streamDeck.logger.debug('Found compatible headset', {
        path: headset.path,
        manufacturer: headset.manufacturer,
        product: headset.product
      });

      device = new HID.HID(headset.path);
      streamDeck.logger.debug('Successfully opened HID device');
      
      // Request battery status
      streamDeck.logger.trace('Sending battery status command', {
        command: BatteryLevelAction.BATTERY_STATUS_COMMAND
      });
      device.write(BatteryLevelAction.BATTERY_STATUS_COMMAND);
      
      // Read response with timeout
      streamDeck.logger.trace('Reading response...');
      const response = device.readTimeout(1000);
      streamDeck.logger.trace('Raw response', { response });
      
      if (!response || response.length < BatteryLevelAction.RESPONSE_LENGTH) {
        throw new Error(`Invalid response from headset: length=${response?.length ?? 0}, expected=${BatteryLevelAction.RESPONSE_LENGTH}`);
      }

      // Extract battery level and charging status
      const rawBatteryLevel = response[BatteryLevelAction.BATTERY_LEVEL_BYTE];
      const chargingStatus = response[BatteryLevelAction.CHARGING_STATUS_BYTE];
      
      streamDeck.logger.debug('Parsed response', {
        rawBatteryLevel: `0x${rawBatteryLevel.toString(16)}`,
        chargingStatus: `0x${chargingStatus.toString(16)}`,
        chargingBit: (chargingStatus & BatteryLevelAction.CHARGING_STATUS_MASK) !== 0
      });

      this.currentState = {
        percentage: BatteryLevelAction.convertBatteryLevel(rawBatteryLevel),
        isCharging: (chargingStatus & BatteryLevelAction.CHARGING_STATUS_MASK) !== 0,
        isConnected: true,
      };

      streamDeck.logger.debug('Updated state', { state: this.currentState });
      await this.updateUI();
    } catch (error) {
      streamDeck.logger.error('Error updating battery status', { error });
      this.currentState = {
        percentage: null,
        isCharging: false,
        isConnected: false,
      };
      await this.updateUI();
    } finally {
      // Always close the device connection
      if (device) {
        try {
          streamDeck.logger.debug('Closing HID device');
          device.close();
        } catch (error) {
          streamDeck.logger.error('Error closing device', { error });
        }
      }
    }
  }

  private async updateUI(ev?: WillAppearEvent<Settings>) {
    if (!ev) {
      streamDeck.logger.warn('No event provided to updateUI, skipping update');
      return;
    }

    if (!this.currentState.isConnected) {
      streamDeck.logger.info('Headset disconnected, showing alert');
      await ev.action.showAlert();
      await ev.action.setTitle('Disconnected');
      return;
    }

    const title = `${this.currentState.percentage}%${this.currentState.isCharging ? ' ⚡' : ''}`;
    streamDeck.logger.debug('Updating UI', { title });
    await ev.action.setTitle(title);
  }
} 