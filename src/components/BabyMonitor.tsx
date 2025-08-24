import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Camera, Mic, MicOff, Video, VideoOff, ArrowLeft, Wifi } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';

interface BabyMonitorProps {
  onBack: () => void;
}

const BabyMonitor = ({ onBack }: BabyMonitorProps) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [connectedParents, setConnectedParents] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());

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
          console.log('Permissions API not available, proceeding with getUserMedia');
        }
      }

      const constraints = {
        video: { 
          facingMode: 'user',
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };

      console.log('Requesting camera and microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Stream obtained successfully:', stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        
        // Ensure video plays on mobile - important for iOS
        try {
          await videoRef.current.play();
          console.log('Video playback started');
        } catch (playError) {
          console.log('Video playback error (this is normal on some devices):', playError);
        }
      }

      setIsStreaming(true);
      setConnectionStatus('connected');
      
      // Setup network broadcasting for device discovery
      await setupNetworkBroadcasting();
      
      console.log('Baby monitor activated and discoverable on network');
      
    } catch (error: any) {
      console.error('Error accessing camera/microphone:', error);
      
      setConnectionStatus('disconnected');
      
      // Provide more specific error messages for iOS
      let errorMessage = '';
      
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Camera and microphone access denied. Please go to Settings > Privacy & Security > Camera/Microphone and allow access for this app.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'No camera or microphone found. Please check your device has these capabilities.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'Camera or microphone is busy. Please close other apps using camera/microphone and try again.';
      } else if (error.name === 'AbortError') {
        errorMessage = 'Camera access was interrupted. Please try again.';
      } else if (error.name === 'NotSupportedError') {
        errorMessage = 'Camera/microphone not supported on this device or browser.';
      } else {
        errorMessage = `Permission error: ${error.message}. Please check app permissions in device settings.`;
      }
      
      alert(errorMessage);
    }
  };

  const stopMonitoring = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // Cleanup network broadcasting
    cleanupNetworkBroadcasting();

    setIsStreaming(false);
    setConnectionStatus('disconnected');
    setConnectedParents(0);
  };

  const toggleMic = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

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

  // Setup network broadcasting for device discovery
  const setupNetworkBroadcasting = async () => {
    try {
      const deviceInfo = await Device.getInfo();
      const deviceId = await Device.getId();
      
      // Create broadcast channel for local network discovery
      broadcastChannelRef.current = new BroadcastChannel('baby-monitor-discovery');
      
      const deviceData = {
        id: deviceId.identifier || `baby-${Date.now()}`,
        name: `${deviceInfo.model || 'Baby'} Room Monitor`,
        platform: deviceInfo.platform,
        type: 'baby-monitor',
        timestamp: Date.now()
      };
      
      // Broadcast device availability every 5 seconds
      const broadcastInterval = setInterval(() => {
        if (broadcastChannelRef.current && isStreaming) {
          broadcastChannelRef.current.postMessage({
            type: 'device-announcement',
            device: { ...deviceData, timestamp: Date.now() }
          });
        }
      }, 5000);
      
      // Listen for parent monitor connection requests
      broadcastChannelRef.current.onmessage = async (event) => {
        const { type, parentId, offer } = event.data;
        
        if (type === 'connection-request' && streamRef.current) {
          await handleParentConnection(parentId, offer);
        } else if (type === 'parent-disconnected') {
          handleParentDisconnection(parentId);
        }
      };
      
      // Initial announcement
      broadcastChannelRef.current.postMessage({
        type: 'device-announcement',
        device: deviceData
      });
      
      return () => clearInterval(broadcastInterval);
      
    } catch (error) {
      console.error('Error setting up network broadcasting:', error);
    }
  };

  // Handle parent monitor connections via WebRTC
  const handleParentConnection = async (parentId: string, offer: RTCSessionDescriptionInit) => {
    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      
      // Add stream tracks to peer connection
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          peerConnection.addTrack(track, streamRef.current!);
        });
      }
      
      // Set remote description (offer from parent)
      await peerConnection.setRemoteDescription(offer);
      
      // Create and send answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      // Send answer back via broadcast channel
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.postMessage({
          type: 'connection-answer',
          parentId,
          answer
        });
      }
      
      // Store peer connection
      peerConnectionsRef.current.set(parentId, peerConnection);
      setConnectedParents(prev => prev + 1);
      
      peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'disconnected' || 
            peerConnection.connectionState === 'failed') {
          handleParentDisconnection(parentId);
        }
      };
      
    } catch (error) {
      console.error('Error handling parent connection:', error);
    }
  };

  const handleParentDisconnection = (parentId: string) => {
    const peerConnection = peerConnectionsRef.current.get(parentId);
    if (peerConnection) {
      peerConnection.close();
      peerConnectionsRef.current.delete(parentId);
      setConnectedParents(prev => Math.max(0, prev - 1));
    }
  };

  const cleanupNetworkBroadcasting = () => {
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.close();
      broadcastChannelRef.current = null;
    }
    
    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
  };

  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background p-4 pt-safe-area-top">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pt-4">
        <Button 
          variant="ghost" 
          onClick={onBack}
          className="flex items-center gap-2 min-h-12 px-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            connectionStatus === 'connected' ? 'bg-success' : 
            connectionStatus === 'connecting' ? 'bg-warning' : 'bg-destructive'
          }`} />
          <span className="text-sm capitalize text-muted-foreground">
            {connectionStatus}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-md mx-auto">
        <Card className="p-6 text-center mb-6">
          <div className="w-20 h-20 mx-auto mb-4 bg-secondary rounded-full flex items-center justify-center">
            <Camera className="w-10 h-10 text-secondary-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-2 text-card-foreground">Baby Monitor Mode</h2>
          <p className="text-muted-foreground mb-6">
            {isStreaming ? 'Your baby is being monitored safely' : 'Ready to start monitoring'}
          </p>

          {/* Video Preview */}
          <div className="relative mb-6 bg-muted rounded-lg overflow-hidden aspect-video">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {!isCameraEnabled && (
              <div className="absolute inset-0 bg-muted flex items-center justify-center">
                <VideoOff className="w-12 h-12 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="space-y-4">
            {!isStreaming ? (
              <Button 
                onClick={startMonitoring}
                className="w-full bg-success text-success-foreground hover:bg-success-dark"
                size="lg"
              >
                Start Monitoring
              </Button>
            ) : (
              <>
                <div className="flex gap-3 justify-center">
                  <Button
                    variant={isMicEnabled ? "default" : "destructive"}
                    size="icon"
                    onClick={toggleMic}
                    className="rounded-full w-12 h-12"
                  >
                    {isMicEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                  </Button>
                  
                  <Button
                    variant={isCameraEnabled ? "default" : "destructive"}
                    size="icon"
                    onClick={toggleCamera}
                    className="rounded-full w-12 h-12"
                  >
                    {isCameraEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
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
          </Card>
        )}
      </div>
    </div>
  );
};

export default BabyMonitor;