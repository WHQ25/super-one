Pod::Spec.new do |s|
  s.name = 'SuperOneVoiceAudio'
  s.version = '0.1.0'
  s.summary = 'Buffered WebRTC voice playback and call audio lifecycle'
  s.description = s.summary
  s.license = { :type => 'Proprietary' }
  s.author = 'SuperOne'
  s.homepage = 'https://github.com/WHQ25/super-one'
  s.source = { :git => 'https://github.com/WHQ25/super-one.git' }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'react-native-webrtc'
  s.frameworks = 'AVFoundation', 'AudioToolbox'
  s.source_files = '**/*.{h,m,swift}'
end
