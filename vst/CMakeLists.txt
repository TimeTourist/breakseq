# Breakseq as a VST3 instrument for Reason 13 on Windows (docs/vst-spec.md).
# The web app in web/ is built first (npm run build) and zipped; BREAKSEQ_WEB_ZIP points at the zip.
cmake_minimum_required(VERSION 3.25)

project(Breakseq VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(BREAKSEQ_WEB_ZIP "" CACHE FILEPATH "The built web app (web/dist) as a zip")

if(NOT EXISTS "${BREAKSEQ_WEB_ZIP}")
    message(FATAL_ERROR "BREAKSEQ_WEB_ZIP must name the zipped web/dist (see .github/workflows/vst.yml)")
endif()

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

# Named web.zip so the data is BinaryData::web_zip.
configure_file("${BREAKSEQ_WEB_ZIP}" "${CMAKE_CURRENT_BINARY_DIR}/web.zip" COPYONLY)
juce_add_binary_data(BreakseqWeb SOURCES "${CMAKE_CURRENT_BINARY_DIR}/web.zip")

target_sources(Breakseq PRIVATE
    src/PluginProcessor.cpp
    src/PluginEditor.cpp
    src/Clips.cpp
    src/Mixer.cpp
    src/Sampler.cpp)

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

# The mixer's and the sampler's tests: run by the workflow after the build.
juce_add_console_app(BreakseqTests PRODUCT_NAME "BreakseqTests")
target_sources(BreakseqTests PRIVATE tests/Main.cpp tests/MixerTests.cpp tests/SamplerTests.cpp tests/ClipsTests.cpp src/Clips.cpp src/Mixer.cpp src/Sampler.cpp)
target_compile_definitions(BreakseqTests PRIVATE JUCE_USE_CURL=0 JUCE_WEB_BROWSER=0)
target_link_libraries(BreakseqTests
    PRIVATE juce::juce_core juce::juce_audio_basics
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
