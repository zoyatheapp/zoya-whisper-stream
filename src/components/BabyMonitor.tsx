import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Camera, Mic, MicOff, Video, VideoOff, ArrowLeft, Wifi } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Network } from '@capacitor/network';

interface BabyMonitorProps {
  onBack: () => void;
}

const BabyMonitor = ({ onBack }: BabyMonitorProps) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [connectedParents, setConnectedParents] = useState<number>(0);
  const [showNetworkInfo, setShowNetworkInfo] = useState(false);
  const [ipAddress, setIpAddress] = useState('');
  const [port, setPort] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const discoveryIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const webSocketRef = useRef<WebSocket | null>(null);

  const startMonitoring = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    try {
      setConnectionStatus('connecting');
      
      // On native platforms, we need to handle permissions differently
      if (Capacitor.isNativePlatform()) {
        console.log('Running on native platform, requesting native permissions...');
        
        // Request permissions through native APIs
        try {
          const permissions = await (navigator as any).permissions?.query({ name: 'camera' });
          console.log('Camera permission status:', permissions?.state);
        } catch (e) {
@@ -144,75 +147,92 @@ const BabyMonitor = ({ onBack }: BabyMonitorProps) => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !isMicEnabled;
        setIsMicEnabled(!isMicEnabled);
      }
    }
  };

  const toggleCamera = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !isCameraEnabled;
        setIsCameraEnabled(!isCameraEnabled);
      }
    }
  };

  const handleShowNetworkInfo = async () => {
    try {
      const status = await Network.getStatus();
      const host = (status as any).ipAddress || window.location.hostname;
      const currentPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
      setIpAddress(host);
      setPort(currentPort);
      setShowNetworkInfo(true);
    } catch (error) {
      console.error('Error getting network info:', error);
    }
  };

  // Setup network broadcasting for device discovery using localStorage and BroadcastChannel
  const setupNetworkBroadcasting = async () => {
    try {
      const deviceInfo = await Device.getInfo();
      const deviceId = await Device.getId();
      const networkStatus = await Network.getStatus();
      
      console.log('Network status:', networkStatus);
      console.log('Setting up baby monitor for network discovery...');
      
      if (!networkStatus.connected) {
        console.log('Device not connected to network');
        return;
      }
      
      const networkAddress = (networkStatus as any).ipAddress || window.location.hostname;
      const currentPort = window.location.port ? parseInt(window.location.port) : undefined;

      const deviceData = {
        id: deviceId.identifier || `baby-${Date.now()}`,
        name: `${deviceInfo.model || 'Baby'} Room Monitor`,
        platform: deviceInfo.platform,
        type: 'baby-monitor',
        timestamp: Date.now(),
        status: 'active',
        lastSeen: Date.now(),
        networkId: networkStatus.connectionType,
        networkAddress: '192.168.1.100' // Simulated IP for network representation
        networkAddress,
        port: currentPort
      };

      console.log('Device data created:', deviceData);

      // Store device in localStorage with network-like key for discovery
      const networkKey = `zoya-baby-monitor-${deviceData.id}`;
      localStorage.setItem(networkKey, JSON.stringify(deviceData));
      console.log('Device stored in network registry:', networkKey);

      // Create network discovery channel
      const networkChannel = new BroadcastChannel('zoya-network-discovery');
      
      // Listen for discovery requests from parent monitors
      networkChannel.onmessage = async (event) => {
        const { type, parentId } = event.data;
        console.log('Received network discovery message:', event.data);
        
        if (type === 'parent-discovery-request') {
          console.log('Parent discovery request received, announcing device...');
          
          // Respond immediately with device announcement
          setTimeout(() => {
            networkChannel.postMessage({
              type: 'baby-monitor-network-announcement',
              device: {
@@ -472,48 +492,61 @@ const BabyMonitor = ({ onBack }: BabyMonitorProps) => {
                  </Button>
                </div>
                
                <Button 
                  onClick={stopMonitoring}
                  variant="destructive"
                  className="w-full"
                  size="lg"
                >
                  Stop Monitoring
                </Button>
              </>
            )}
          </div>
        </Card>

        {/* Connection Info */}
        {isStreaming && (
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wifi className="w-5 h-5 text-success" />
                <div>
                  <p className="font-medium text-card-foreground">Broadcasting on Local Network</p>
                  <p className="text-sm text-muted-foreground">
                    {connectedParents > 0 
                    {connectedParents > 0
                      ? `${connectedParents} parent${connectedParents > 1 ? 's' : ''} connected`
                      : 'Ready for parent connections'
                    }
                  </p>
                </div>
              </div>
              

              {connectedParents > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
                  <span className="text-sm font-medium text-success">{connectedParents}</span>
                </div>
              )}
            </div>

            <div className="mt-4 text-center">
              {!showNetworkInfo ? (
                <Button size="sm" onClick={handleShowNetworkInfo}>
                  Show IP & Port
                </Button>
              ) : (
                <div className="text-sm text-muted-foreground">
                  <p>IP: {ipAddress}</p>
                  <p>Port: {port}</p>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default BabyMonitor;
