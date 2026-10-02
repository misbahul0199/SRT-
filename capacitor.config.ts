// Capacitor configuration for Android/iOS mobile packaging
const config = {
  appId: 'io.subsync.app',
  appName: 'SubSync AI Studio',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#020617',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#020617',
    },
  },
};

export default config;
