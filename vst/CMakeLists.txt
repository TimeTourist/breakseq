# Breakseq as a VST3 instrument for Reason 13 on Windows (docs/vst-spec.md).
# Phase 0 is a spike: see docs/tasks/vst-fas-0.md.
cmake_minimum_required(VERSION 3.25)

project(Breakseq VERSION 0.0.1)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(juce
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG 8.0.12
    GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(juce)

juce_add_plugin(Breakseq
    COMPANY_NAME "Magnus"
    PRODUCT_NAME "Breakseq"
    PLUGIN_MANUFACTURER_CODE Mgrn
    PLUGIN_CODE Bksq
    FORMATS VST3 Standalone
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    VST3_CATEGORIES Instrument Drum
    NEEDS_WEBVIEW2 TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE)

juce_add_binary_data(BreakseqWeb SOURCES spike/index.html)

target_sources(Breakseq PRIVATE
    src/PluginProcessor.cpp
    src/PluginEditor.cpp
    src/MidiClip.cpp)

target_compile_definitions(Breakseq PUBLIC
    JUCE_WEB_BROWSER=1
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0)

target_link_libraries(Breakseq
    PRIVATE
        BreakseqWeb
        juce::juce_audio_utils
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)
