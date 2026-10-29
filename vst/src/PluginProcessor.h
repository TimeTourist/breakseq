#pragma once

#include "Mixer.h"

#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>

/**
 * Breakseq in Reason (docs/vst-spec.md): the page in the editor is the web
 * app; this side keeps the project in the song's state, reports Reason's
 * tempo and plays what the page's player schedules (Mixer).
 */
class BreakseqProcessor final : public juce::AudioProcessor
{
public:
    BreakseqProcessor();

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    /** The host's tempo as last seen by processBlock; 0 until it says. */
    double getBpm() const { return bpm.load(); }

    /** The project as the page last saved it: a project file in base64, or empty in a new instance. */
    juce::String getProject() const;
    void setProject (const juce::String& base64);

    Mixer& getMixer() { return mixer; }

private:
    std::atomic<double> bpm { 0.0 };
    Mixer mixer;

    juce::CriticalSection projectLock;
    juce::String project;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (BreakseqProcessor)
};
