#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <vector>

/**
 * Phase 0 spike: plays a test sound made by the web page on C1 (note-off cuts
 * it), reports Reason's tempo and keeps a counter in the song's state.
 */
class BreakseqProcessor final : public juce::AudioProcessor
{
public:
    /** C1, where the first piece goes (as in the web app's MIDI export). */
    static constexpr int firstNote = 36;

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

    /** The host's tempo as last seen by processBlock; 120 until it says. */
    double getBpm() const { return bpm.load(); }

    int getCounter() const { return counter.load(); }
    void setCounter (int value) { counter.store (value); }

    /** Replaces the sound C1 plays (mono, at the host's sample rate). Message thread. */
    void setSound (std::vector<float> samples);

private:
    std::atomic<double> bpm { 120.0 };
    std::atomic<int> counter { 0 };

    // The audio thread only tries the lock, so it never waits for setSound.
    juce::SpinLock soundLock;
    std::vector<float> sound;
    size_t position = 0;
    bool playing = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (BreakseqProcessor)
};
