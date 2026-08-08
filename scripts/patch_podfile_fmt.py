#!/usr/bin/env python3
"""Patch Expo-generated ios/Podfile for Xcode 26 + fmt 11 consteval breakage."""

from __future__ import annotations

from pathlib import Path

MARKER = "DeskLink Xcode26 fmt fix"

BLOCK = r"""
    # DeskLink Xcode26 fmt fix: Apple Clang consteval break on fmt 11.x
    installer.pods_project.targets.each do |target|
      if target.name == 'fmt'
        target.build_configurations.each do |config|
          config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
          defs = config.build_settings['GCC_PREPROCESSOR_DEFINITIONS']
          defs = ['$(inherited)'] if defs.nil?
          defs = [defs] unless defs.is_a?(Array)
          defs << 'FMT_USE_CONSTEVAL=0' unless defs.any? { |d| d.to_s.include?('FMT_USE_CONSTEVAL') }
          config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs
        end
      end
      # Align min iOS for resource pods that still advertise 9.0
      target.build_configurations.each do |config|
        deployment = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if deployment && deployment.to_f < 12.0
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '12.0'
        end
      end
    end
"""


def main() -> int:
    pod = Path("ios/Podfile")
    if not pod.is_file():
        print(f"ERROR: {pod} not found")
        return 1
    text = pod.read_text(encoding="utf-8")
    if MARKER in text:
        print("Podfile already patched")
        return 0
    needle = "post_install do |installer|"
    if needle in text:
        text = text.replace(needle, needle + "\n" + BLOCK, 1)
    else:
        text += f"\n{needle}\n{BLOCK}\nend\n"
    pod.write_text(text, encoding="utf-8")
    print("Patched ios/Podfile for fmt C++17")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
