Pod::Spec.new do |s|
  s.name = 'SuperOneHinge'
  s.version = '0.1.0'
  s.summary = 'iPhone Duo hinge posture for the workspace sidebar'
  s.description = s.summary
  s.license = { :type => 'Proprietary' }
  s.author = 'SuperOne'
  s.homepage = 'https://github.com/WHQ25/super-one'
  s.source = { :git => 'https://github.com/WHQ25/super-one.git' }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
