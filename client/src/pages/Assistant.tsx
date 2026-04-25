import { useEffect, useState } from "react";
import {
  loadAIConfig,
  saveAIConfig,
  clearAIConfig,
  onAIConfigChange,
  type AIConfig,
} from "../lib/aiConfig";
import { AssistantOnboarding } from "../components/AssistantOnboarding";
import { AssistantChat } from "../components/AssistantChat";

export function Assistant() {
  const [config, setConfig] = useState<AIConfig | null>(loadAIConfig);

  useEffect(() => onAIConfigChange(() => setConfig(loadAIConfig())), []);

  if (!config) {
    return (
      <AssistantOnboarding
        onSave={(c) => {
          saveAIConfig(c);
          setConfig(c);
        }}
      />
    );
  }
  return (
    <AssistantChat
      config={config}
      onClear={() => {
        clearAIConfig();
        setConfig(null);
      }}
    />
  );
}
