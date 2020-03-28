# Change Log

All notable changes to the "Crank Scenario Language" extension will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/).

## v0.3.0 - 2020.03.27
- Added IntelliSense support for _dynamic_ `{{tokens}}`, for steps that follow
  others that provide them. Note: Dynamic token support was added in Crank in
  `v0.10.0`, and may not yet be fully supported/exposed by all Cog versions.
- Fixed a bug where IntelliSense would not show up due to a case mismatch on
  some Scenario step expression text.

## v0.2.0 - 2019.11.10
- Added IntelliSense support for defined `{{tokens}}` when present in scenario.

## v0.1.1 - 2019.11.10
- YAML format specification for `.crank.yml` files.
- IntelliSense support for step expression text (based on Crank cog registry)
- IntelliSense support for data keys (based on Crank cog registry)
- IntelliSense support for cog and stepId keys (based on Crank cog registry)
- File contextual menu item to run the given scenario in a VS Code terminal
