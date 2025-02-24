import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { BatteryLevelAction } from "./actions/battery-level";

// Enable trace logging for development
streamDeck.logger.setLevel(LogLevel.TRACE);

// Register the battery level action
streamDeck.actions.registerAction(new BatteryLevelAction());

// Connect to the Stream Deck
streamDeck.connect();
