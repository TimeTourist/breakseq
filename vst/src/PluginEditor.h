#pragma once

#include "PluginProcessor.h"

#include <juce_gui_extra/juce_gui_extra.h>

/** A field in the bar that a clip is dragged from, to Reason, as a file. Empty, it says what makes it. */
class DragField final : public juce::Component
{
public:
    DragField (BreakseqProcessor&, BreakseqProcessor::Field, juce::String empty);

    void paint (juce::Graphics&) override;
    void mouseDrag (const juce::MouseEvent&) override;

private:
    BreakseqProcessor& processor;
    const BreakseqProcessor::Field field;
    const juce::String empty;
    bool dragging = false;
};

/**
 * The bar at the bottom of the window (docs/vst-spec.md, Song to Audio och
 * Song to MIDI): the two buttons, which the page answers, the drag fields,
 * and what is going on or wrong, with the warning when Reason's tempo is not
 * the one the frozen pieces were made in.
 */
class ReasonBar final : public juce::Component
{
public:
    ReasonBar (BreakseqProcessor&, std::function<void (const juce::String&)> songTo);

    void paint (juce::Graphics&) override;
    void resized() override;
    /** Shows the processor's state as it is now. */
    void refresh();

private:
    BreakseqProcessor& processor;
    juce::TextButton toAudio { "Song to Audio" };
    juce::TextButton toMidi { "Song to MIDI" };
    DragField audio, midi, space;
    juce::Label status;
};

/** The web app in WebView2, served from the plugin itself, over the bar. */
class BreakseqEditor final : public juce::AudioProcessorEditor,
                             private juce::Timer
{
public:
    explicit BreakseqEditor (BreakseqProcessor&);
    ~BreakseqEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void saveFile (const juce::String& name, const juce::String& base64);
    void freeze (const juce::var& payload);
    void clip (const juce::var& payload);
    void openProjectFile (juce::WebBrowserComponent::NativeFunctionCompletion);
    void newProjectFile (juce::WebBrowserComponent::NativeFunctionCompletion);

    BreakseqProcessor& processor;
    juce::WebBrowserComponent web;
    ReasonBar bar;
    std::unique_ptr<juce::FileChooser> chooser;
    double sentBpm = 0.0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (BreakseqEditor)
};
